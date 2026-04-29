const fs = require("fs");

const OPTIONS_PATH = "/data/options.json";

const DEFAULT_CONFIG = {
  scan_interval_minutes: 60,
  max_items_per_source: 80,
  save_images: true,
  enable_ocr: false,
  ocr_only_when_missing: true,
  ocr_max_items_per_run: 20,
  towns: ["Orsago", "Cordignano", "Godega", "San Fior"],
  log_level: "info",
  listen_port: 8099,
};

function loadConfig() {
  if (!fs.existsSync(OPTIONS_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(OPTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      towns: Array.isArray(parsed.towns) && parsed.towns.length > 0 ? parsed.towns : DEFAULT_CONFIG.towns,
    };
  } catch (error) {
    console.error("[config] Errore lettura /data/options.json, uso default:", error.message);
    return { ...DEFAULT_CONFIG };
  }
}

module.exports = {
  loadConfig,
  DEFAULT_CONFIG,
};
