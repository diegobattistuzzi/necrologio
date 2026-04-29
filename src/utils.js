function normalizeText(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function absoluteUrl(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

function splitName(fullName) {
  const clean = normalizeText(fullName);
  if (!clean) {
    return { nome: "", cognome: "" };
  }

  const parts = clean.split(" ");
  if (parts.length === 1) {
    return { nome: parts[0], cognome: "" };
  }

  return {
    nome: parts[0],
    cognome: parts.slice(1).join(" "),
  };
}

function findTown(haystack, configuredTowns) {
  const text = normalizeForMatch(haystack);
  const aliases = {
    orsago: ["orsago"],
    cordignano: ["cordignano"],
    godega: ["godega", "godega di sant'urbano", "godega di santurbano", "bibano"],
    "san fior": ["san fior"],
  };

  for (const town of configuredTowns) {
    const key = normalizeForMatch(town);
    const keys = aliases[key] || [key];
    if (keys.some((k) => text.includes(k))) {
      return town;
    }
  }

  return null;
}

function extractDateFromText(text) {
  const value = normalizeText(text);
  if (!value) {
    return null;
  }

  const regexes = [
    /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4})/i,
  ];

  for (const re of regexes) {
    const match = value.match(re);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function extractFuneralDate(text) {
  const value = normalizeText(text);
  if (!value) {
    return null;
  }

  const funeralSentence = value.match(
    /(funeral[ei]|esequie|cerimonia|rosario)[^.\n]{0,140}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4})/i
  );

  if (funeralSentence) {
    return funeralSentence[2];
  }

  return extractDateFromText(value);
}

function dateToSortableNumber(value) {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }

  const slash = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (slash) {
    const dd = Number(slash[1]);
    const mm = Number(slash[2]);
    let yyyy = Number(slash[3]);
    if (yyyy < 100) {
      yyyy += 2000;
    }
    return yyyy * 10000 + mm * 100 + dd;
  }

  const monthMap = {
    gennaio: 1,
    febbraio: 2,
    marzo: 3,
    aprile: 4,
    maggio: 5,
    giugno: 6,
    luglio: 7,
    agosto: 8,
    settembre: 9,
    ottobre: 10,
    novembre: 11,
    dicembre: 12,
  };

  const longForm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);

  if (longForm) {
    const dd = Number(longForm[1]);
    const mm = monthMap[longForm[2]] || 0;
    const yyyy = Number(longForm[3]);
    return yyyy * 10000 + mm * 100 + dd;
  }

  return 0;
}

module.exports = {
  normalizeText,
  normalizeForMatch,
  absoluteUrl,
  splitName,
  findTown,
  extractDateFromText,
  extractFuneralDate,
  dateToSortableNumber,
};
