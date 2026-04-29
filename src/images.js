const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const SHARE_IMAGES_DIR = "/share/necrologi_images";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getExtensionFromUrl(url) {
  const clean = (url || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return ".png";
  if (clean.endsWith(".webp")) return ".webp";
  if (clean.endsWith(".gif")) return ".gif";
  return ".jpg";
}

function filenameForUrl(url) {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  const ext = getExtensionFromUrl(url);
  return `${hash}${ext}`;
}

async function downloadImage(url, destinationPath) {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 25000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HomeAssistantNecrologiBot/1.0)",
      Accept: "image/*,*/*;q=0.8",
    },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function persistImages(items) {
  ensureDir(SHARE_IMAGES_DIR);

  for (const item of items) {
    const url = item.foto || null;
    if (!url) {
      item.foto_file = null;
      item.foto_api_url = null;
      continue;
    }

    try {
      const filename = filenameForUrl(url);
      const fullPath = path.join(SHARE_IMAGES_DIR, filename);

      if (!fs.existsSync(fullPath)) {
        await downloadImage(url, fullPath);
      }

      item.foto_file = `/share/necrologi_images/${filename}`;
      item.foto_api_url = `/images/${filename}`;
    } catch (error) {
      console.warn(`[images] Errore download ${url}: ${error.message}`);
      item.foto_file = null;
      item.foto_api_url = null;
    }
  }

  return items;
}

module.exports = {
  SHARE_IMAGES_DIR,
  persistImages,
};
