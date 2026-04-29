const express = require("express");
const { loadConfig } = require("./config");
const { scrapeAll } = require("./scraper");
const { readData, writeData } = require("./storage");
const { SHARE_IMAGES_DIR, persistImages } = require("./images");

const app = express();
app.use(express.json());
app.use("/images", express.static(SHARE_IMAGES_DIR));

let state = {
  lastUpdate: null,
  running: false,
  items: readData(),
  lastError: null,
};

const config = loadConfig();

async function refreshData() {
  if (state.running) {
    return { skipped: true, reason: "already_running" };
  }

  state.running = true;
  state.lastError = null;

  try {
    let items = await scrapeAll(config);

    if (config.save_images) {
      items = await persistImages(items);
    }

    state.items = items;
    state.lastUpdate = new Date().toISOString();
    writeData(items);
    console.log(`[refresh] Completato: ${items.length} necrologi utili`);
    return { skipped: false, count: items.length };
  } catch (error) {
    state.lastError = error.message;
    console.error("[refresh] Errore:", error);
    return { skipped: false, error: error.message };
  } finally {
    state.running = false;
  }
}

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    running: state.running,
    last_update: state.lastUpdate,
    items: state.items.length,
    last_error: state.lastError,
  });
});

app.get("/obituaries", (req, res) => {
  const town = (req.query.town || "").toString().trim().toLowerCase();
  const limit = Number(req.query.limit || 0);

  let items = state.items;
  if (town) {
    items = items.filter((x) => (x.paese || "").toLowerCase() === town);
  }
  if (Number.isFinite(limit) && limit > 0) {
    items = items.slice(0, limit);
  }

  res.json({
    updated_at: state.lastUpdate,
    count: items.length,
    items,
  });
});

app.get("/obituaries/latest", (req, res) => {
  const limit = Math.max(1, Number(req.query.limit || 10));
  const items = state.items.slice(0, limit);
  res.json({
    updated_at: state.lastUpdate,
    count: items.length,
    items,
  });
});

app.post("/refresh", async (_, res) => {
  const result = await refreshData();
  res.json({
    ok: !result.error,
    ...result,
    last_update: state.lastUpdate,
  });
});

app.listen(config.listen_port, async () => {
  console.log(`[server] Necrologi add-on in ascolto su porta ${config.listen_port}`);
  await refreshData();
  const intervalMs = Math.max(10, Number(config.scan_interval_minutes || 60)) * 60 * 1000;
  setInterval(refreshData, intervalMs);
  console.log(`[server] Refresh schedulato ogni ${config.scan_interval_minutes} minuti`);
});
