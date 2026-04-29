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

const SOURCES = [
  {
    id: "servizi_salvador",
    label: "Servizi Salvador",
    listUrl: "https://www.servizisalvador.it/necrologi/",
    type: "salvador",
  },
  {
    id: "ultimoviaggio",
    label: "Ultimo Viaggio",
    listUrl: "https://ultimoviaggio.it/necrologi/",
    type: "ultimoviaggio",
  },
  {
    id: "memorial",
    label: "Memorial",
    listUrl: "https://www.onoranzefunebrimemorial.it/necrologi/",
    type: "memorial",
  },
  {
    id: "san_osvaldo",
    label: "San Osvaldo",
    listUrl: "https://onoranzefunebrisanosvaldo.it/necrologi/",
    type: "sanosvaldo",
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
  },
  {
    id: "salamon",
    label: "Pompe Funebri Salamon",
    listUrl: "https://www.pompefunebrisalamon.com/condoglianze-online/",
    type: "salamon",
  },
  {
    id: "lapace_conegliano",
    label: "Onoranze Funebri La Pace Conegliano",
    listUrl: "https://www.onoranzefunebrilapaceconegliano.com/annunci-funebri/",
    type: "lapace",
  },
  {
    id: "zanardo",
    label: "Agenzia Funebre Zanardo",
    listUrl: "https://www.agenziafunebrezanardo.it/condoglianze-online/",
    type: "zanardo",
  },
  {
    id: "roman",
    label: "Onoranze Funebri Roman",
    listUrl: "https://www.ofroman.com/lista-annunci-db.php",
    type: "roman",
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
    $("h2 a[href], h3 a[href]").each((_, el) => {
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
      if (/\/necrologi\/?$/i.test(href) || /\/necrologi\/page\//i.test(href)) {
        return;
      }
      if (!href.includes("onoranzefunebrisanosvaldo.it")) {
        return;
      }
      if (/\/contattaci|\/servizi|\/privacy|\/privacy-policy|\/gestione-dei-cookie|\/category\//i.test(href)) {
        return;
      }
      const parentText = normalizeText($(el).closest("article, div, li").text());
      const dateHint = extractDateFromText(parentText);
      push(href, title, dateHint);
    });
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
    $(".postArticle a[href], a[data-blog-post-alias][href]").each((_, el) => {
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
      if (/\/necrologi-cordogli-online-cordignano\/?$/i.test(href)) {
        return;
      }
      if (/\/privacy|\/cookie|\/contatti|\/servizi|\/articoli/i.test(href)) {
        return;
      }

      const card = $(el).closest(".postArticle, article, li, div");
      const parentText = normalizeText(card.text());
      const dateHint = extractDateFromText(parentText);
      const styleImage = extractBackgroundImageUrl(card.find(".blogImg").first().attr("style"));
      const imgSrc = card.find(".blogImg img").first().attr("src");
      push(href, title, dateHint, styleImage || imgSrc || null);
    });
  }

  if (source.type === "salamon") {
    $("h3 a[href*='/condoglianze-online/'], h2 a[href*='/condoglianze-online/']").each((_, el) => {
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
      if (/\/condoglianze-online\/?$/i.test(href)) {
        return;
      }

      const parentText = normalizeText($(el).closest("article, li, div").text());
      const dateHint = extractDateFromText(parentText);
      push(href, title, dateHint);
    });
  }

  if (source.type === "lapace") {
    $("h2 a[href*='/annuncio/'], h3 a[href*='/annuncio/']").each((_, el) => {
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
      if (/\/annunci-funebri\/?$/i.test(href)) {
        return;
      }
      if (/\/privacy|\/cookie|\/contatti|\/servizi|\/storie-di-vita|\/socrem-tv/i.test(href)) {
        return;
      }

      const parentText = normalizeText($(el).closest("article, li, div").text());
      const dateHint = extractDateFromText(parentText);
      push(href, title, dateHint);
    });
  }

  if (source.type === "zanardo") {
    $("h3 a[href*='/condoglianze-online/'], h2 a[href*='/condoglianze-online/']").each((_, el) => {
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
      if (/\/condoglianze-online\/?$/i.test(href)) {
        return;
      }

      const parentText = normalizeText($(el).closest("article, li, div").text());
      const dateHint = extractDateFromText(parentText);
      push(href, title, dateHint);
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
    return bodyText;
  }

  return normalizeText($("article, main, .post, .entry-content, body").first().text());
}

function toTitleCase(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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

async function scrapeDetail(entry, source, options, ocrState, aiState) {
  try {
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
    const detailImageUrl = absoluteUrl(
      entry.url,
      extractImage(
        $,
        source.id === "servizi_salvador" ||
          source.id === "salamon" ||
          source.id === "lapace_conegliano" ||
          source.id === "zanardo"
      )
    );
    const imageUrl = entry.listImageUrl || detailImageUrl;
    const bodyText = extractDetailBodyText($, source);
    const contextText = `${personTitle || title} ${bodyText}`;
    let town = findTown(contextText, options.towns);

    let funeralDate =
      source.id === "memorial"
        ? (entry.listDateHint || extractFuneralDate(bodyText) || null)
        : (extractFuneralDate(bodyText) || entry.listDateHint || null);

    const ocrEligibleSource =
      source.id === "ultimoviaggio" ||
      source.id === "zanette" ||
      source.id === "servizi_salvador" ||
      source.id === "salamon" ||
      source.id === "lapace_conegliano" ||
      source.id === "zanardo" ||
      source.id === "roman";
    const mustRunOcr =
      options.enable_ocr &&
      ocrEligibleSource &&
      ocrState.used < options.ocr_max_items_per_run &&
      (!options.ocr_only_when_missing || !town || !funeralDate);

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

        if (!town && ocr.town) {
          town = ocr.town;
        }
        if (!funeralDate && ocr.funeralDate) {
          funeralDate = ocr.funeralDate;
        }
      } catch (error) {
        console.warn(`[ocr] Errore OCR su ${entry.url}: ${error.message}`);
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
    if (!funeralDate && extracted.data_funerale) {
      funeralDate = extracted.data_funerale;
    }

    const finalTitle = personTitle || title;
    const split = splitName(finalTitle.replace(/\s+-\s+.*$/, ""));
    // Zanette pubblica "Cognome Nome", quindi invertiamo
    const { nome, cognome } = source.id === "zanette"
      ? { nome: split.cognome, cognome: split.nome }
      : split;

    const hiddenOld = Boolean(funeralDate && isOlderThanDays(funeralDate, 10));
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
      anni: extracted.anni || null,
      parenti: extracted.parenti,
      luogo_funerale: extracted.luogo_funerale,
      rosario: extracted.rosario,
      ai_used: extracted.ai_used,
      ocr_used: ocrUsed,
      ocr_confidence: ocrConfidence,
      hidden_old: hiddenOld,
      scraped_at: new Date().toISOString(),
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
        const shouldReprocessExisting =
          source.id === "lapace_conegliano" &&
          (existingNameIsNoisy || !existingItem.nome || !existingItem.cognome);

        if (shouldReprocessExisting) {
          detail = await scrapeDetail(entry, source, options, ocrState, aiState);
        } else {
        const hiddenOld = Boolean(existingItem.data_funerale && isOlderThanDays(existingItem.data_funerale, 10));
        if (hiddenOld) {
          console.info(`[scraper] Nascosto da cache per data vecchia (>10 giorni): source=${source.id} title=${existingItem.full_name || entry.title} data_funerale=${existingItem.data_funerale}`);
        } else {
          console.debug(`[scraper] Riutilizzato da cache senza riprocessare/OCR: source=${source.id} title=${existingItem.full_name || entry.title}`);
        }
        detail = {
          ...existingItem,
          hidden_old: hiddenOld,
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
