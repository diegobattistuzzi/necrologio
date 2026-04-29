const axios = require("axios");
const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const { normalizeText, findTown, extractFuneralDate } = require("./utils");

function ensureTesseractWordFiles() {
  // Alcune build cercano questi file nella cwd (es. ./ita.special-words)
  // Se non presenti, Tesseract può loggare errori rumorosi.
  const cwd = process.cwd();
  const files = ["ita.special-words", "eng.special-words"];

  for (const file of files) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, "", "utf8");
    }
  }
}

function isLikelyImageUrl(url) {
  const value = (url || "").toLowerCase();
  if (!value || value.startsWith("data:")) {
    return false;
  }

  return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(value);
}

async function runOcrFromImage(imageUrl, towns) {
  if (!isLikelyImageUrl(imageUrl)) {
    return {
      text: "",
      town: null,
      funeralDate: null,
      confidence: null,
      used: false,
    };
  }

  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HomeAssistantNecrologiBot/1.0)",
      Accept: "image/*,*/*;q=0.8",
    },
  });

  ensureTesseractWordFiles();

  let result;
  try {
    result = await Tesseract.recognize(Buffer.from(response.data), "ita+eng", {
      logger: () => {},
    });
  } catch (error) {
    console.warn(`[ocr] Tesseract fallback su eng: ${error.message}`);
    result = await Tesseract.recognize(Buffer.from(response.data), "eng", {
      logger: () => {},
    });
  }

  const text = normalizeText(result?.data?.text || "");
  const town = findTown(text, towns);
  const funeralDate = extractFuneralDate(text);
  const confidence = Number.isFinite(result?.data?.confidence) ? Number(result.data.confidence) : null;

  return {
    text,
    town,
    funeralDate,
    confidence,
    used: true,
  };
}

module.exports = {
  runOcrFromImage,
};
