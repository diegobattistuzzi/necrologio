const axios = require("axios");
const cheerio = require("cheerio");
const {
  normalizeText,
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

const DEFAULT_WP_UPLOADS_MAX_AGE_MONTHS = 2;

const SOURCES = [
  {
    id: "servizi_salvador",
    label: "Servizi Salvador",
    listUrl: "https://www.servizisalvador.it/necrologi/",
    type: "salvador",
    preferLinkedImage: true,
    ocrEligible: true,
  },
  {
    id: "ultimoviaggio",
    label: "Ultimo Viaggio",
    listUrl: "https://ultimoviaggio.it/necrologi/",
    type: "ultimoviaggio",
    ocrEligible: true,
  },
  {
    id: "memorial",
    label: "Memorial",
    listUrl: "https://www.onoranzefunebrimemorial.it/necrologi/",
    type: "memorial",
    funeralDateListHintFirst: true,
  },
  {
    id: "san_osvaldo",
    label: "San Osvaldo",
    listUrl: "https://onoranzefunebrisanosvaldo.it/necrologi/",
    type: "sanosvaldo",
    listingRule: {
      detailSelector: "h2 a[href], h3 a[href]",
      skipListPageRegex: /\/necrologi\/?$|\/necrologi\/page\//i,
      requiredHostIncludes: "onoranzefunebrisanosvaldo.it",
      blockedUrlRegex: /\/contattaci|\/servizi|\/privacy|\/privacy-policy|\/gestione-dei-cookie|\/category\//i,
    },
  },
  {
    id: "san_pietro_faldon",
    label: "Onoranze Funebri San Pietro Faldon",
    listUrl: "https://onoranzefunebrisanpietrofaldon.it/elenco-necrologi/",
    type: "sanpietrofaldon",
    listingRule: {
      detailSelector: "h2 a[href*='/necrologi/'], h3 a[href*='/necrologi/']",
      skipListPageRegex: /\/elenco-necrologi\/?$/i,
      requiredHostIncludes: "onoranzefunebrisanpietrofaldon.it",
      blockedUrlRegex: /\/privacy|\/cookie|\/contatti|\/servizi|\/chi-siamo|\/cerimonia/i,
    },
    ocrEligible: true,
    ocrRequired: true,
    ocrPrimaryTown: true,
    ocrPrimaryFuneralDate: true,
    wpUploadsMaxAgeMonths: 2,
  },
  {
    id: "pfa_san_marco",
    label: "PFA San Marco",
    listUrl: "https://www.pfasanmarco.it/annunci-funebri/",
    type: "pfasanmarco",
  },
  {
    id: "zanette",
    label: "Onoranze Funebri Zanette",
    listUrl: "https://www.onoranzefunebrizanette.it/necrologi-cordogli-online-cordignano",
    type: "zanette",
    listingRule: {
      detailSelector: ".postArticle a[href], a[data-blog-post-alias][href]",
      skipListPageRegex: /\/necrologi-cordogli-online-cordignano\/?$/i,
      blockedUrlRegex: /\/privacy|\/cookie|\/contatti|\/servizi|\/articoli/i,
    },
    ocrEligible: true,
    swapFirstLastName: true,
  },
  {
    id: "salamon",
    label: "Pompe Funebri Salamon",
    listUrl: "https://www.pompefunebrisalamon.com/condoglianze-online/",
    type: "salamon",
    listingRule: {
      detailSelector: "h3 a[href*='/condoglianze-online/'], h2 a[href*='/condoglianze-online/']",
      skipListPageRegex: /\/condoglianze-online\/?$/i,
    },
    preferLinkedImage: true,
    ocrEligible: true,
  },
  {
    id: "lapace_conegliano",
    label: "Onoranze Funebri La Pace Conegliano",
    listUrl: "https://www.onoranzefunebrilapaceconegliano.com/annunci-funebri/",
    type: "lapace",
    listingRule: {
      detailSelector: "h2 a[href*='/annuncio/'], h3 a[href*='/annuncio/']",
      skipListPageRegex: /\/annunci-funebri\/?$/i,
      blockedUrlRegex: /\/privacy|\/cookie|\/contatti|\/servizi|\/storie-di-vita|\/socrem-tv/i,
    },
    preferLinkedImage: true,
    ocrEligible: true,
    reprocessWhenNameNoisy: true,
  },
  {
    id: "zanardo",
    label: "Agenzia Funebre Zanardo",
    listUrl: "https://www.agenziafunebrezanardo.it/condoglianze-online/",
    type: "zanardo",
    listingRule: {
      detailSelector: "h3 a[href*='/condoglianze-online/'], h2 a[href*='/condoglianze-online/']",
      skipListPageRegex: /\/condoglianze-online\/?$/i,
    },
    preferLinkedImage: true,
    ocrEligible: true,
  },
  {
    id: "roman",
    label: "Onoranze Funebri Roman",
    listUrl: "https://www.ofroman.com/lista-annunci-db.php",
    type: "roman",
    ocrEligible: true,
  },
  {
    id: "sandrin",
    label: "Onoranze Funebri Sandrin",
    listUrl: "https://www.onoranzefunebrisandrin.com/necrologi/",
    type: "sandrin",
    listingRule: {
      detailSelector: "h2 a[href]",
      skipListPageRegex: /\/necrologi\/?$/i,
      blockedUrlRegex: /\/privacy|\/(cookie|contatti|servizi|chi-siamo|pubblicazione)/i,
    },
    ocrEligible: true,
  },
  {
    id: "boscaia",
    label: "Onoranze Funebri Boscaia",
    listUrl: "https://boscaia.com/epigrafi.php",
    type: "boscaia",
    ocrEligible: true,
  },
];

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

  function push(link, title, listDateHint, listImageUrl) {
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
    });
  }

  function parseStandardLinks(rule, options = {}) {
    if (!rule || !rule.detailSelector) {
      return;
    }

    $(rule.detailSelector).each((_, el) => {
      const href = $(el).attr("href");
      const title = normalizeText($(el).text());
      if (!href || !title) {
        return;
      }
      if (isNoiseTitle(title)) {
        return;
      }
      if (title.split(" ").length < 2) {
        return;
      }
      if (rule.skipListPageRegex && rule.skipListPageRegex.test(href)) {
        return;
      }
      if (rule.requiredHostIncludes && !href.includes(rule.requiredHostIncludes)) {
        return;
      }
      if (rule.blockedUrlRegex && rule.blockedUrlRegex.test(href)) {
        return;
      }

      const cardSelector = options.cardSelector || "article, li, div";
      const parentText = normalizeText($(el).closest(cardSelector).text());
      const dateHint = extractDateFromText(parentText);
      const listImageUrl = options.extractListImage ? options.extractListImage($(el)) : null;
      push(href, title, dateHint, listImageUrl);
    });
  }

  if (source.type === "salvador") {
    $("a[href*='/necrologi/']").each((_, el) => {
      const href = $(el).attr("href");
      const text = normalizeText($(el).text());
      if (!href || href.endsWith("/necrologi/") || !text || /invia cordoglio/i.test(text)) {
        return;
      }

      const dateHint = extractDateFromText(text);
      const cleaned = text.replace(/\bInvia Cordoglio\b/gi, "");
      const noDate = cleaned.replace(/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\s*/i, "");
      push(href, noDate, dateHint);
    });
  }

  if (source.type === "ultimoviaggio") {
    $("a").each((_, el) => {
      const text = normalizeText($(el).text());
      if (!/^Leggi tutto\s+/i.test(text)) {
        return;
      }
      const href = $(el).attr("href");
      const title = text.replace(/^Leggi tutto\s+/i, "");
      push(href, title, null);
    });
  }

  if (source.type === "memorial") {
    $("a[href*='/necrologio/']").each((_, el) => {
      const href = $(el).attr("href");
      const title = normalizeText($(el).text());
      if (!title || title.length < 4) {
        return;
      }
      const cardText = normalizeText($(el).parent().text());
      const dateHint = extractDateFromText(cardText);
      push(href, title, dateHint);
    });
  }

  if (source.type === "sanosvaldo") {
    parseStandardLinks(source.listingRule, { cardSelector: "article, div, li" });
  }

  if (source.type === "pfasanmarco") {
    $("a[href*='/annuncio/']").each((_, el) => {
      const href = $(el).attr("href");
      const title = normalizeText($(el).text());
      if (!href || !title) {
        return;
      }
      if (title.split(" ").length < 2) {
        return;
      }

      const parentText = normalizeText($(el).closest("article, li, div").text());
      const dateHint = extractDateFromText(parentText);
      push(href, title, dateHint);
    });
  }

  if (source.type === "zanette") {
    parseStandardLinks(source.listingRule, {
      cardSelector: ".postArticle, article, li, div",
      extractListImage: (el) => {
        const card = el.closest(".postArticle, article, li, div");
        const styleImage = extractBackgroundImageUrl(card.find(".blogImg").first().attr("style"));
        const imgSrc = card.find(".blogImg img").first().attr("src");
        return styleImage || imgSrc || null;
      },
    });
  }

  if (source.type === "salamon") {
    parseStandardLinks(source.listingRule);
  }

  if (source.type === "lapace") {
    parseStandardLinks(source.listingRule);
  }

  if (source.type === "zanardo") {
    parseStandardLinks(source.listingRule);
  }

  if (source.type === "sanpietrofaldon") {
    parseStandardLinks(source.listingRule);
  }

  if (source.type === "boscaia") {
    $("h3").each((_, el) => {
      const h3 = $(el);
      const title = normalizeText(h3.text());
      if (!title || title.split(" ").length < 2) {
        return;
      }
      if (isNoiseTitle(title)) {
        return;
      }

      // Cerca il link "VEDI EPIGRAFE" nel contenitore padre (o nonno)
      let container = h3.parent();
      let vepiHref = container.find("a").filter((_, a) => /vedi epigrafe/i.test($(a).text())).first().attr("href");
      if (!vepiHref) {
        container = h3.parent().parent();
        vepiHref = container.find("a").filter((_, a) => /vedi epigrafe/i.test($(a).text())).first().attr("href");
      }
      if (!vepiHref || !/\/\d+\.html/.test(vepiHref)) {
        return;
      }

      const imgSrc = container.find("img").first().attr("src");
      const containerText = normalizeText(container.text());
      const dateHint = extractDateFromText(containerText);
      push(vepiHref, title, dateHint, imgSrc || null);
    });
  }

  if (source.type === "sandrin") {
    parseStandardLinks(source.listingRule, {
      cardSelector: "article, .post, li, div",
      extractListImage: (el) => {
        const card = el.closest("article, .post, li, div");
        const imgSrc = card.find("img").first().attr("src") ||
          card.find("[style*='background-image']").attr("style");
        return imgSrc && !String(imgSrc).includes("background") ? imgSrc : null;
      },
    });
  }

  if (source.type === "roman") {
    $("a[href*='annuncio-db.php?uuid=']").each((_, el) => {
      const href = $(el).attr("href");
      const title = normalizeText($(el).text());
      if (!href || !title) {
        return;
      }
      if (title.split(" ").length < 2) {
        return;
      }
      if (isNoiseTitle(title)) {
        return;
      }

      const parentText = normalizeText($(el).closest("article, li, div, section").text());
      const dateHint = extractDateFromText(parentText);
      push(href, title, dateHint);
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
  if (source.id === "memorial") {
    const memorialText = normalizeText(
      $("#obituary-details").children().text() + " " + $("#service-details").children().text()
    );
    if (memorialText) {
      return memorialText;
    }
  }

  if (source.id === "san_osvaldo") {
    const bodyText = normalizeText($("article, main, .post, .entry-content, body").first().text());
    const cutoffMatch = bodyText.match(/^(.*?)(?:\bO\.?F\.?\s*S\.?\s*Osvaldo\b)/i);
    if (cutoffMatch && cutoffMatch[1]) {
      return normalizeText(cutoffMatch[1]);
    }
    return applyGeneralCutoff(bodyText);
  }

  if (source.id === "san_pietro_faldon") {
    const bodyText = normalizeText($("article, main, .post, .entry-content, body").first().text());
    const cutoffMatch = bodyText.match(
      /^(.*?)(?:\bCONTATTACI\b|\bSede di SAN PIETRO DI FELETTO\b|\bPompe Funebri Cappella Maggiore\b)/i
    );
    if (cutoffMatch && cutoffMatch[1]) {
      return normalizeText(cutoffMatch[1]);
    }
    return applyGeneralCutoff(bodyText);
  }

  const rawText = normalizeText($("article, main, .post, .entry-content, body").first().text());
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
    const html = await fetchHtml(entry.url);
    const $ = cheerio.load(html);

    const extractedTitle = extractBestTitle($, entry.title);
    const title = isNoiseTitle(extractedTitle) ? normalizeText(entry.title) : extractedTitle;
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
    const detailImageUrl = absoluteUrl(entry.url, extractImage($, Boolean(source.preferLinkedImage)));
    const imageUrl = entry.listImageUrl || detailImageUrl;
    const hiddenByWpUploads = isOldByWpUploadsMonth(imageUrl, source.wpUploadsMaxAgeMonths);
    if (hiddenByWpUploads) {
      console.info(`[scraper] Nascosto da wp-content/uploads vecchio: source=${source.id} title=${personTitle || title} image=${imageUrl}`);
    }
    const bodyText = extractDetailBodyText($, source);
    const contextText = `${personTitle || title} ${bodyText}`;
    const htmlTown = findTown(contextText, options.towns);
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
    funeralDate = chooseHigherDate(funeralDate, extracted.data_funerale);

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
      ora_funerale: extracted.ora_funerale || null,
      anni: extracted.anni || null,
      parenti: extracted.parenti,
      luogo_funerale: extracted.luogo_funerale,
      rosario: extracted.rosario,
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
