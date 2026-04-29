const axios = require("axios");
const Tesseract = require("tesseract.js");
const { normalizeText, findTown, extractFuneralDate } = require("./utils");

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

  const result = await Tesseract.recognize(Buffer.from(response.data), "ita+eng", {
    logger: () => {},
  });

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
