const axios = require("axios");
const cheerio = require("cheerio");
const {
  normalizeText,
  normalizeForMatch,
  absoluteUrl,
  splitName,
  cleanPersonTitle,
  findTown,
  extractDateFromText,
  extractFuneralDate,
  dateToSortableNumber,
  isOlderThanDays,
} = require("./utils");
const { runOcrFromImage } = require("./ocr");
const { extractAnnouncementDetails } = require("./ai_extraction");
const { SOURCES } = require("./sources");

const DEFAULT_WP_UPLOADS_MAX_AGE_MONTHS = 2;

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 25000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HomeAssistantNecrologiBot/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return response.data;
}

function isNoiseTitle(title) {
  const text = normalizeText(title).toLowerCase();
  if (!text) {
    return true;
  }

  return /(onoranze funebri|annunci funebri|necrologi|cordoglio online|condoglianze online|contattaci|servizi|privacy|cookie|casa funeraria|powered by|leggi di piu|carica di piu|storie di vita|storia di vita|store di vita)/i.test(text);
}

function parseListing($, source, maxItems) {
  const entries = [];
  const seen = new Set();

  function extractBackgroundImageUrl(styleValue) {
    if (!styleValue) {
      return null;
    }
    const match = String(styleValue).match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
    return match ? normalizeText(match[2]) : null;
  }

  function push(link, title, listDateHint, listImageUrl, extra = {}) {
    const url = absoluteUrl(source.listUrl, link);
    const cleanTitle = normalizeText(title);
    if (!url || !cleanTitle) {
      return;
    }
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    entries.push({
      url,
      title: cleanTitle,
      listDateHint: normalizeText(listDateHint),
      listImageUrl: listImageUrl ? absoluteUrl(source.listUrl, listImageUrl) : null,
      ...extra,
    });
  }

  function extractInfoBoxValue(container, labelRegex) {
    let result = null;
    container.find(".space_bottom").each((_, el) => {
      if (result) {
        return;
      }

      const text = normalizeText($(el).text());
      if (labelRegex.test(text)) {
        result = normalizeText($(el).find("strong").first().text());
      }
    });

    return result;
  }

  function normalizeFuneralTimeFromText(text) {
    const match = normalizeText(text).match(/\balle\s+ore\s*(\d{1,2})[:.](\d{2})\b/i);
    if (!match) {
      return null;
    }

    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return null;
    }

    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  function parseStandardLinks(rule) {
    if (!rule || !rule.detailSelector) {
      return;
    }

    const cardSelector = rule.cardSelector || "article, li, div";

    $(rule.detailSelector).each((_, el) => {
      const href = $(el).attr("href");
      let title = normalizeText($(el).text());

      if (!href || !title) return;

      // Skip on raw values before cleaning
      if (rule.skipIfHrefEndsWith && href.endsWith(rule.skipIfHrefEndsWith)) return;
      if (rule.skipIfTextMatches && rule.skipIfTextMatches.test(title)) return;
      if (rule.textPrefixRequired && !rule.textPrefixRequired.test(title)) return;

      // Clean title
      if (rule.stripTextPrefix) title = normalizeText(title.replace(rule.stripTextPrefix, ""));
      if (rule.stripTextRegex) title = normalizeText(title.replace(rule.stripTextRegex, ""));
      if (rule.stripLeadingDate) title = normalizeText(title.replace(/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\s*/i, ""));

      if (!title) return;
      if (isNoiseTitle(title)) return;

      const minWords = rule.minTitleWords != null ? rule.minTitleWords : 2;
      if (title.split(" ").length < minWords) return;

      const minLen = rule.minTitleLength || 0;
      if (title.length < minLen) return;

      if (rule.skipListPageRegex && rule.skipListPageRegex.test(href)) return;
      if (rule.requiredHostIncludes && !href.includes(rule.requiredHostIncludes)) return;
      if (rule.blockedUrlRegex && rule.blockedUrlRegex.test(href)) return;

      const card = $(el).closest(cardSelector);
      const dateHint = rule.skipDateHint ? null : extractDateFromText(normalizeText(card.text()));

      let listImageUrl = null;
      if (rule.listImageStyleSelector) {
        const styleEl = card.find(rule.listImageStyleSelector).first();
        const bgUrl = extractBackgroundImageUrl(styleEl.attr("style"));
        const srcUrl = rule.listImageSrcFromStyleSelector
          ? card.find(rule.listImageSrcFromStyleSelector).first().attr("src") || null
          : null;
        listImageUrl = bgUrl || srcUrl || null;
      } else if (rule.listImageSrcSelector) {
        const imgSrc = card.find(rule.listImageSrcSelector).first().attr("src");
        listImageUrl = imgSrc && !String(imgSrc).includes("background") ? imgSrc : null;
      }

      push(href, title, dateHint, listImageUrl);
    });
  }

  function parseTitleLinks(rule) {
    if (!rule || !rule.titleSelector || !rule.linkTextMatch) {
      return;
    }

    const maxDepth = rule.linkSearchDepth || 1;

    $(rule.titleSelector).each((_, el) => {
      const title = normalizeText($(el).text());
      if (!title || title.split(" ").length < 2 || isNoiseTitle(title)) return;

      let container = $(el).parent();
      let linkHref = null;

      for (let depth = 1; depth <= maxDepth && !linkHref; depth++) {
        if (depth > 1) container = container.parent();
        const candidate = container
          .find("a")
          .filter((_, a) => rule.linkTextMatch.test(normalizeText($(a).text())))
          .first()
          .attr("href");
        if (candidate && (!rule.linkHrefMustMatch || rule.linkHrefMustMatch.test(candidate))) {
          linkHref = candidate;
        }
      }

      if (!linkHref) return;
      if (rule.skipListPageRegex && rule.skipListPageRegex.test(linkHref)) return;
      if (rule.blockedUrlRegex && rule.blockedUrlRegex.test(linkHref)) return;

      const imgSrc = rule.listImageSrcSelector
        ? container.find(rule.listImageSrcSelector).first().attr("src") || null
        : null;
      const dateHint = extractDateFromText(normalizeText(container.text()));
      push(linkHref, title, dateHint, imgSrc);
    });
  }

  if (source.listingRule) {
    if (source.listingRule.titleSelector) {
      parseTitleLinks(source.listingRule);
    } else {
      parseStandardLinks(source.listingRule);
    }
  }

  if (source.type === "necrologieonline") {
    $(".property-row").each((index, el) => {
      const row = $(el);
      const content = row.find(".property-row-content").first();
      const title = normalizeText(content.find(".property-row-title").first().text());
      if (!title || title.split(" ").length < 2 || isNoiseTitle(title)) {
        return;
      }

      const bodyText = normalizeText(content.text());
      const townHint = extractInfoBoxValue(content, /comune\s+di\s*:/i);
      const funeralDate = extractFuneralDate(bodyText);
      const imageUrl = row.find(".property-row-picture img").first().attr("src");
      const idHref = row.find("a[href*='idd=']").first().attr("href") || "";
      const idMatch = idHref.match(/[?&]idd=(\d+)/i);
      const anchor = idMatch ? `#idd-${idMatch[1]}` : `#item-${index + 1}`;
      const subtitleText = normalizeText(content.find(".property-row-subtitle").first().text());
      const ageMatch = subtitleText.match(/\banni\s+(\d{1,3})\b/i);
      const ceremonyBlock = content.find(".col-lg-12.space_bottom").filter((_, block) =>
        /cerimonia/i.test(normalizeText($(block).text()))
      ).first();
      const ceremonyPlace = normalizeText(ceremonyBlock.find("strong").eq(0).text());
      const ceremonyTown = normalizeText(ceremonyBlock.find("strong").eq(1).text());
      const rosaryText = normalizeText(content.find("#frase_footer").first().text());

      push(anchor, title, funeralDate, imageUrl, {
        detailBodyText: bodyText,
        townHint,
        extractedDetails: {
          anni: ageMatch ? Number(ageMatch[1]) : null,
          data_funerale: funeralDate,
          ora_funerale: normalizeFuneralTimeFromText(bodyText),
          luogo_funerale: normalizeText([ceremonyPlace, ceremonyTown ? `di ${ceremonyTown}` : ""].filter(Boolean).join(" ")) || null,
          rosario: /rosario/i.test(rosaryText) ? rosaryText : null,
        },
      });
    });
  }

  return entries.slice(0, maxItems);
}

function extractBestTitle($, fallback) {
  const candidates = [
    normalizeText($("h1").first().text()),
    normalizeText($("h2").first().text()),
    normalizeText($("meta[property='og:title']").attr("content")),
    normalizeText($("title").text()),
    normalizeText(fallback),
  ].filter(Boolean);

  return candidates[0] || fallback || "";
}

function extractImage($, preferLinkedJpg) {
  // Per siti come Salvador l'epigrafe è un link <a href="...jpg">, non un <img>
  if (preferLinkedJpg) {
    const linkedJpg = $("a[href]").filter((_, el) => /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test($(el).attr("href") || "")).first().attr("href");
    if (linkedJpg) {
      return linkedJpg;
    }
  }

  const candidates = [
    $("meta[property='og:image']").attr("content"),
    $("article img").first().attr("src"),
    $("main img").first().attr("src"),
    $("img").first().attr("src"),
  ].filter(Boolean);

  return candidates[0] || null;
}

// Pattern che segnalano l'inizio di sezioni di "rumore" (sidebar, footer, altri necrologi, form)
// che non appartengono al testo del singolo necrologio.
const BODY_TEXT_CUTOFF_REGEX = /(?:mostra\s+altri\s+necrologi|altri\s+necrologi|post\s+(?:pi[uù]\s+recente|meno\s+recente)|articolo\s+(?:successivo|precedente)|invia\s+messaggio|lascia\s+un\s+(?:messaggio|commento)|condividi\s+(?:su|il\s+tuo)|iscriviti\s+alla\s+newsletter|privacy\s+policy|utilizziamo\s+i\s+cookie|tutti\s+i\s+diritti\s+riservati|designed\s+by)/i;

function applyGeneralCutoff(text) {
  if (!text) return text;
  const match = text.match(new RegExp(`^([\\s\\S]*?)(?:${BODY_TEXT_CUTOFF_REGEX.source})`, BODY_TEXT_CUTOFF_REGEX.flags.replace("g", "")));
  return match && match[1] && match[1].length > 60 ? normalizeText(match[1]) : text;
}

function extractDetailBodyText($, source) {
  if (source.detailBodySelector) {
    const selected = normalizeText($(source.detailBodySelector).text());
    if (selected) {
      return selected;
    }
  }

  const rawText = normalizeText($("article, main, .post, .entry-content, body").first().text());

  if (source.detailBodyCutoffRegex) {
    const cutoffMatch = rawText.match(
      new RegExp(`^([\\s\\S]*?)(?:${source.detailBodyCutoffRegex.source})`, "i")
    );
    if (cutoffMatch && cutoffMatch[1]) {
      return normalizeText(cutoffMatch[1]);
    }
  }

  return applyGeneralCutoff(rawText);
}

function toTitleCase(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function chooseHigherDate(...values) {
  let best = null;
  let bestSort = 0;

  for (const value of values) {
    const candidate = normalizeText(value || "");
    if (!candidate) {
      continue;
    }
    const sortable = dateToSortableNumber(candidate);
    if (!sortable) {
      continue;
    }
    if (!best || sortable > bestSort) {
      best = candidate;
      bestSort = sortable;
    }
  }

  return best;
}

function findConfiguredTown(value, configuredTowns) {
  const key = normalizeForMatch(value);
  if (!key) {
    return null;
  }

  return (configuredTowns || []).find((town) => normalizeForMatch(town) === key) || null;
}

function deriveNameFromObituaryUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const slug = decodeURIComponent(segments[segments.length - 1] || "");
    const clean = normalizeText(slug.replace(/[\-_]+/g, " "));
    if (!clean || clean.split(" ").length < 2) {
      return "";
    }
    return toTitleCase(clean);
  } catch {
    return "";
  }
}

function getWpUploadsYearMonth(url) {
  const value = normalizeText(url || "");
  if (!value) {
    return null;
  }
  const match = value.match(/\/wp-content\/uploads\/(\d{4})\/(\d{1,2})\//i);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
}

function isOldByWpUploadsMonth(url, maxAgeMonths) {
  const ym = getWpUploadsYearMonth(url);
  if (!ym) {
    return false;
  }

  const now = new Date();
  const currentIndex = now.getFullYear() * 12 + (now.getMonth() + 1);
  const itemIndex = ym.year * 12 + ym.month;
  const ageInMonths = currentIndex - itemIndex;

  if (ageInMonths < 0) {
    return false;
  }

  return ageInMonths > Math.max(0, Number(maxAgeMonths || DEFAULT_WP_UPLOADS_MAX_AGE_MONTHS));
}

async function scrapeDetail(entry, source, options, ocrState, aiState) {
  try {
    const downloadedAt = new Date().toISOString();
    let bodyText = normalizeText(entry.detailBodyText || "");
    let detailImageUrl = null;
    let title = normalizeText(entry.title);

    if (!bodyText) {
      const html = await fetchHtml(entry.url);
      const $ = cheerio.load(html);

      const extractedTitle = extractBestTitle($, entry.title);
      title = isNoiseTitle(extractedTitle) ? normalizeText(entry.title) : extractedTitle;
      detailImageUrl = absoluteUrl(entry.url, extractImage($, Boolean(source.preferLinkedImage)));
      bodyText = extractDetailBodyText($, source);
    }

    let personTitle = cleanPersonTitle(title);
    if (!personTitle || isNoiseTitle(personTitle)) {
      const fallbackFromUrl = deriveNameFromObituaryUrl(entry.url);
      if (fallbackFromUrl) {
        personTitle = cleanPersonTitle(fallbackFromUrl);
      }
    }

    if (isNoiseTitle(personTitle || title)) {
      return null;
    }
    const imageUrl = entry.listImageUrl || detailImageUrl;
    const hiddenByWpUploads = isOldByWpUploadsMonth(imageUrl, source.wpUploadsMaxAgeMonths);
    if (hiddenByWpUploads) {
      console.info(`[scraper] Nascosto da wp-content/uploads vecchio: source=${source.id} title=${personTitle || title} image=${imageUrl}`);
    }
    const contextText = `${personTitle || title} ${bodyText}`;
    const townHint = findConfiguredTown(entry.townHint, options.towns);
    const htmlTown = source.structuredTownOnly ? townHint : (townHint || findTown(contextText, options.towns));
    let town = htmlTown;

    const htmlFuneralDate =
      source.funeralDateListHintFirst
        ? (entry.listDateHint || extractFuneralDate(bodyText) || null)
        : (extractFuneralDate(bodyText) || entry.listDateHint || null);
    let funeralDate = htmlFuneralDate;

    const ocrEligibleSource = Boolean(source.ocrEligible);
    const ocrRequired = Boolean(source.ocrRequired);
    const mustRunOcr =
      (options.enable_ocr || ocrRequired) &&
      ocrEligibleSource &&
      !hiddenByWpUploads &&
      (ocrRequired || ocrState.used < options.ocr_max_items_per_run) &&
      (ocrRequired || !options.ocr_only_when_missing || !town || !funeralDate);

    if (ocrRequired) {
      console.info(
        `[scraper] OCR obbligatorio: source=${source.id} htmlTown=${htmlTown || "n.d."} htmlFuneralDate=${htmlFuneralDate || "n.d."} image=${imageUrl || "n.d."}`
      );
    }

    let ocrUsed = false;
    let ocrConfidence = null;
    let ocrText = "";

    if (mustRunOcr) {
      try {
        const ocr = await runOcrFromImage(imageUrl, options.towns);
        if (ocr.used) {
          ocrState.used += 1;
          ocrUsed = true;
          ocrConfidence = ocr.confidence;
          ocrText = normalizeText(ocr.text || "");
        }

        if (source.ocrPrimaryTown && ocr.town) {
          town = ocr.town;
        } else if (!town && ocr.town) {
          town = ocr.town;
        }
        if (source.ocrPrimaryFuneralDate && ocr.funeralDate) {
          funeralDate = ocr.funeralDate;
        } else if (!funeralDate && ocr.funeralDate) {
          funeralDate = ocr.funeralDate;
        }
      } catch (error) {
        console.warn(`[ocr] Errore OCR su ${entry.url}: ${error.message}`);
      }
    }

    if (ocrRequired) {
      if (!ocrUsed) {
        console.info(`[scraper] Scartato: OCR richiesto ma non eseguito o immagine non valida | source=${source.id} url=${entry.url}`);
        return null;
      }
      if (!town) {
        console.info(`[scraper] Scartato: OCR richiesto ma paese non trovato | source=${source.id} url=${entry.url}`);
        return null;
      }
    }

    if (!town) {
      return null;
    }

    // AI chiamata DOPO il filtro paese: non spreca budget su item che verranno scartati
    const aiInputText = ocrUsed && ocrText ? ocrText : bodyText;
    if (!aiInputText) {
      console.debug(`[ai] Chiamata evitata: input_vuoto | source=${source.id} url=${entry.url}`);
    }
    const extracted = aiInputText
      ? await extractAnnouncementDetails(aiInputText, options, aiState)
      : { ai_used: false };
    const entryDetails = entry.extractedDetails || {};
    funeralDate = chooseHigherDate(funeralDate, entryDetails.data_funerale, extracted.data_funerale);
    const funeralPlace = extracted.luogo_funerale || entryDetails.luogo_funerale || null;
    const funeralPlaceTown = findTown(funeralPlace, options.towns);
    if (funeralPlaceTown && funeralPlaceTown !== town) {
      console.info(`[scraper] Comune aggiornato dal luogo funerale: source=${source.id} town=${town || "n.d."} luogo_funerale=${funeralPlace} nuovo_paese=${funeralPlaceTown}`);
      town = funeralPlaceTown;
    }

    const finalTitle = personTitle || title;
    const split = splitName(finalTitle.replace(/\s+-\s+.*$/, ""));
    // Zanette pubblica "Cognome Nome", quindi invertiamo
    const { nome, cognome } = source.swapFirstLastName
      ? { nome: split.cognome, cognome: split.nome }
      : split;

    const hiddenOld = Boolean((funeralDate && isOlderThanDays(funeralDate, 10)) || hiddenByWpUploads);
    if (hiddenOld) {
      console.info(`[scraper] Nascosto per data vecchia (>10 giorni): source=${source.id} title=${finalTitle} data_funerale=${funeralDate}`);
    }

    return {
      id: `${source.id}:${entry.url}`,
      source: source.label,
      source_id: source.id,
      source_url: source.listUrl,
      obituary_url: entry.url,
      full_name: finalTitle,
      nome,
      cognome,
      foto: imageUrl,
      paese: town,
      data_funerale: funeralDate,
      ora_funerale: extracted.ora_funerale || entryDetails.ora_funerale || null,
      anni: extracted.anni || entryDetails.anni || null,
      parenti: extracted.parenti || entryDetails.parenti,
      luogo_funerale: funeralPlace,
      rosario: extracted.rosario || entryDetails.rosario,
      ai_used: extracted.ai_used,
      ocr_used: ocrUsed,
      ocr_confidence: ocrConfidence,
      hidden_old: hiddenOld,
      downloaded_at: downloadedAt,
      scraped_at: downloadedAt,
    };
  } catch (error) {
    console.warn(`[scraper] Errore dettaglio ${entry.url}: ${error.message}`);
    return null;
  }
}

function buildExistingItemsMap(items, sourceId) {
  const map = new Map();
  for (const item of items || []) {
    if (!item || !item.id) {
      continue;
    }
    if (sourceId && item.source_id !== sourceId) {
      continue;
    }
    map.set(item.id, item);
  }
  return map;
}

async function scrapeSource(source, options, onProgress, existingItems) {
  try {
    const html = await fetchHtml(source.listUrl);
    const $ = cheerio.load(html);
    const entries = parseListing($, source, options.max_items_per_source);
    const ocrState = { used: 0 };
    const aiState = { used: 0 };
    const existingMap = buildExistingItemsMap(existingItems, source.id);

    const results = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryId = `${source.id}:${entry.url}`;
      const existingItem = existingMap.get(entryId);
      let detail = null;

      if (existingItem) {
        const existingNameIsNoisy = isNoiseTitle(existingItem.full_name || "");
        const shouldReprocessExisting = Boolean(
          source.reprocessWhenNameNoisy &&
          (existingNameIsNoisy || !existingItem.nome || !existingItem.cognome)
        );

        if (shouldReprocessExisting) {
          detail = await scrapeDetail(entry, source, options, ocrState, aiState);
        } else {
        const hiddenByWpUploads = isOldByWpUploadsMonth(existingItem.foto, source.wpUploadsMaxAgeMonths);
        const hiddenOld = Boolean(
          (existingItem.data_funerale && isOlderThanDays(existingItem.data_funerale, 10)) || hiddenByWpUploads
        );
        if (hiddenOld) {
          console.info(`[scraper] Nascosto da cache per data vecchia (>10 giorni): source=${source.id} title=${existingItem.full_name || entry.title} data_funerale=${existingItem.data_funerale}`);
        } else {
          console.debug(`[scraper] Riutilizzato da cache senza riprocessare/OCR: source=${source.id} title=${existingItem.full_name || entry.title}`);
        }
        detail = {
          ...existingItem,
          hidden_old: hiddenOld,
          downloaded_at: existingItem.downloaded_at || existingItem.scraped_at || null,
        };
        }
      } else {
        detail = await scrapeDetail(entry, source, options, ocrState, aiState);
      }

      if (detail) {
        results.push(detail);
      }
      
      if (onProgress && typeof onProgress === 'function') {
        onProgress({
          current: i + 1,
          total: entries.length,
          title: detail ? detail.full_name : entry.title,
          count: results.length,
        });
      }
    }

    return results;
  } catch (error) {
    console.error(`[scraper] Errore sorgente ${source.label}: ${error.message}`);
    return [];
  }
}

async function scrapeAll(options) {
  const all = [];

  const existingItems = options.existingItems || [];

  for (const source of SOURCES) {
    const data = await scrapeSource(source, options, null, existingItems);
    all.push(...data);
  }

  const uniqueMap = new Map();
  for (const item of all) {
    uniqueMap.set(item.id, item);
  }

  return Array.from(uniqueMap.values()).sort((a, b) => {
    const aDate = dateToSortableNumber(a.data_funerale);
    const bDate = dateToSortableNumber(b.data_funerale);
    return bDate - aDate;
  });
}

module.exports = {
  SOURCES,
  scrapeAll,
  scrapeSource,
};
