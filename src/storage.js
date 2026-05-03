const fs = require("fs");
const path = require("path");

const DATA_DIR = "/data";
const DATA_FILE = path.join(DATA_DIR, "obituaries.json");
const SHARE_FILE = "/share/necrologi.json";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }

    const content = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[storage] Errore lettura dati:", error.message);
    return [];
  }
}

function writeData(items) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf8");

  try {
    fs.writeFileSync(SHARE_FILE, JSON.stringify(items, null, 2), "utf8");
  } catch (error) {
    console.warn("[storage] Impossibile scrivere /share/necrologi.json:", error.message);
  }
}

module.exports = {
  readData,
  writeData,
  DATA_FILE,
  SHARE_FILE,
};
