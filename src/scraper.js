const axios = require("axios");
const cheerio = require("cheerio");
const {
  normalizeText,
  absoluteUrl,
  splitName,
  findTown,
  extractDateFromText,
  extractFuneralDate,
  dateToSortableNumber,
} = require("./utils");

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

function parseListing($, source, maxItems) {
  const entries = [];
  const seen = new Set();

  function push(link, title, listDateHint) {
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
    $("h1 a, h2 a, h3 a, a").each((_, el) => {
      const href = $(el).attr("href");
      const title = normalizeText($(el).text());
      if (!href || !title) {
        return;
      }
      if (/leggi di piu|contattaci|servizi|privacy|cookie/i.test(title)) {
        return;
      }
      if (title.split(" ").length < 2) {
        return;
      }
      if (/\/necrologi\/?$/i.test(href)) {
        return;
      }
      if (!href.includes("onoranzefunebrisanosvaldo.it")) {
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

function extractImage($) {
  const candidates = [
    $("meta[property='og:image']").attr("content"),
    $("article img").first().attr("src"),
    $("main img").first().attr("src"),
    $("img").first().attr("src"),
  ].filter(Boolean);

  return candidates[0] || null;
}

async function scrapeDetail(entry, source, towns) {
  try {
    const html = await fetchHtml(entry.url);
    const $ = cheerio.load(html);

    const title = extractBestTitle($, entry.title);
    const imageUrl = absoluteUrl(entry.url, extractImage($));
    const bodyText = normalizeText($("article, main, .post, .entry-content, body").first().text());
    const contextText = `${title} ${bodyText}`;
    const town = findTown(contextText, towns);

    if (!town) {
      return null;
    }

    const funeralDate = extractFuneralDate(bodyText) || entry.listDateHint || null;
    const { nome, cognome } = splitName(title.replace(/\s+-\s+.*$/, ""));

    return {
      id: `${source.id}:${entry.url}`,
      source: source.label,
      source_id: source.id,
      source_url: source.listUrl,
      obituary_url: entry.url,
      full_name: title,
      nome,
      cognome,
      foto: imageUrl,
      paese: town,
      data_funerale: funeralDate,
      scraped_at: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`[scraper] Errore dettaglio ${entry.url}: ${error.message}`);
    return null;
  }
}

async function scrapeSource(source, options) {
  try {
    const html = await fetchHtml(source.listUrl);
    const $ = cheerio.load(html);
    const entries = parseListing($, source, options.max_items_per_source);

    const results = [];
    for (const entry of entries) {
      const detail = await scrapeDetail(entry, source, options.towns);
      if (detail) {
        results.push(detail);
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

  for (const source of SOURCES) {
    const data = await scrapeSource(source, options);
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
};
