const express = require("express");
const path = require("path");
const { loadConfig } = require("./config");
const { scrapeAll, scrapeSource, SOURCES } = require("./scraper");
const { readData, writeData } = require("./storage");
const { SHARE_IMAGES_DIR, persistImages } = require("./images");
const { dateToSortableNumber } = require("./utils");
const { initMqtt, publishMqttUpdate } = require("./mqtt");
const { clearAiCache } = require("./ai_extraction");

const app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.json());
app.use("/images", express.static(SHARE_IMAGES_DIR));

function buildSummaryViewModel(items, updatedAt, includeHidden, hiddenCount) {
  const groupsBySourceId = new Map();

  for (const source of SOURCES) {
    groupsBySourceId.set(source.id, { items: [], label: source.label || source.id });
  }

  for (const item of items) {
    const sourceIdKey = item.source_id || "sconosciuta";
    if (!groupsBySourceId.has(sourceIdKey)) {
      groupsBySourceId.set(sourceIdKey, { items: [], label: item.source || "Sconosciuta" });
    }
    groupsBySourceId.get(sourceIdKey).items.push(item);
  }

  const sourceGroups = Array.from(groupsBySourceId.entries())
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .map(([sourceId, { items: sourceItems, label }]) => ({
      sourceId,
      label,
      count: sourceItems.length,
    }));

  const sortedItems = [...(items || [])].sort(
    (a, b) => dateToSortableNumber(b.data_funerale) - dateToSortableNumber(a.data_funerale)
  );

  return {
    updatedAt: updatedAt || "mai",
    includeHidden: Boolean(includeHidden),
    hiddenCount: Number(hiddenCount || 0),
    sourceGroups,
    sourceCount: groupsBySourceId.size,
    items: sortedItems,
  };
}

let state = {
  lastUpdate: null,
  running: false,
  items: readData(),
  lastError: null,
  forceReprocessSources: new Set(),
};

const config = loadConfig();

function getVisibleItems(items) {
  return (items || []).filter((item) => item && !item.hidden_old);
}

function getNewItems(previousItems, currentItems) {
  const oldIds = new Set((previousItems || []).map((x) => x.id));
  return getVisibleItems(currentItems || []).filter((x) => x && x.id && !oldIds.has(x.id));
}

async function refreshData() {
  if (state.running) {
    return { skipped: true, reason: "already_running" };
  }

  state.running = true;
  state.lastError = null;

  try {
    const previousItems = state.items;
    let items = await scrapeAll({ ...config, existingItems: previousItems });

    if (config.save_images) {
      items = await persistImages(items);
    }

    state.items = items;
    state.lastUpdate = new Date().toISOString();
    writeData(items);
    await publishMqttUpdate({
      config,
      items: state.items,
      updatedAt: state.lastUpdate,
      newItems: getNewItems(previousItems, state.items),
    });
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

async function refreshSource(sourceId) {
  const source = SOURCES.find((s) => s.id === sourceId);
  if (!source) {
    return { error: "Source not found" };
  }

  state.running = true;
  state.lastError = null;

  try {
    const previousItems = state.items;
    const forceReprocess = state.forceReprocessSources.has(sourceId);
    if (forceReprocess) {
      console.info(`[scraper] Forzato reprocess senza cache: source=${source.id}`);
    }
    const sourceExistingItems = forceReprocess ? [] : previousItems;
    let sourceItems = await scrapeSource(source, config, null, sourceExistingItems);

    if (config.save_images) {
      sourceItems = await persistImages(sourceItems);
    }

    const sourceUrlSet = new Set(sourceItems.map((item) => item.id));
    const otherItems = state.items.filter((item) => !sourceUrlSet.has(item.id));

    const merged = [...sourceItems, ...otherItems].sort((a, b) => {
      const aDate = dateToSortableNumber(a.data_funerale);
      const bDate = dateToSortableNumber(b.data_funerale);
      return bDate - aDate;
    });

    state.items = merged;
    state.lastUpdate = new Date().toISOString();
    writeData(merged);
    await publishMqttUpdate({
      config,
      items: state.items,
      updatedAt: state.lastUpdate,
      newItems: getNewItems(previousItems, state.items),
    });
    if (forceReprocess) {
      state.forceReprocessSources.delete(sourceId);
    }
    console.log(`[refresh-source] ${source.label}: ${sourceItems.length} necrologi trovati`);
    return { ok: true, count: sourceItems.length, source: source.label };
  } catch (error) {
    state.lastError = error.message;
    console.error(`[refresh-source] Errore ${source.label}:`, error);
    return { ok: false, error: error.message };
  } finally {
    state.running = false;
  }
}

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    running: state.running,
    last_update: state.lastUpdate,
    items: getVisibleItems(state.items).length,
    hidden_items: (state.items || []).filter((item) => item && item.hidden_old).length,
    last_error: state.lastError,
  });
});

app.get(["/", "/web"], (_, res) => {
  const includeHidden = String(_.query.include_hidden || "").toLowerCase() === "true";
  const visibleItems = getVisibleItems(state.items);
  const itemsToShow = includeHidden ? state.items : visibleItems;
  const hiddenCount = (state.items || []).length - visibleItems.length;
  res.render("summary", buildSummaryViewModel(itemsToShow, state.lastUpdate, includeHidden, hiddenCount));
});

app.get("/obituaries", (req, res) => {
  const town = (req.query.town || "").toString().trim().toLowerCase();
  const limit = Number(req.query.limit || 0);
  const includeHidden = String(req.query.include_hidden || "").toLowerCase() === "true";

  let items = includeHidden ? state.items : getVisibleItems(state.items);
  if (town) {
    items = items.filter((x) => (x.paese || "").toLowerCase() === town);
  }
  if (Number.isFinite(limit) && limit > 0) {
    items = items.slice(0, limit);
  }

  res.json({
    updated_at: state.lastUpdate,
    count: items.length,
    hidden_count: (state.items || []).filter((item) => item && item.hidden_old).length,
    items,
  });
});

app.get("/obituaries/latest", (req, res) => {
  const limit = Math.max(1, Number(req.query.limit || 10));
  const includeHidden = String(req.query.include_hidden || "").toLowerCase() === "true";
  const items = (includeHidden ? state.items : getVisibleItems(state.items)).slice(0, limit);
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

app.post("/clear-ai-cache", async (req, res) => {
  clearAiCache();
  const andRefresh = String(req.query.refresh || "").toLowerCase() === "true";
  if (andRefresh) {
    const result = await refreshData();
    return res.json({ ok: true, cache_cleared: true, refresh: result, last_update: state.lastUpdate });
  }
  res.json({ ok: true, cache_cleared: true });
});

app.post("/reset-source/:sourceId", (req, res) => {
  const sourceId = (req.params.sourceId || "").toString().trim();
  if (!sourceId || !SOURCES.find((s) => s.id === sourceId)) {
    return res.status(400).json({ ok: false, error: "Invalid source ID" });
  }

  const before = state.items.length;
  state.items = state.items.filter((item) => item.source_id !== sourceId);
  const removed = before - state.items.length;
  state.forceReprocessSources.add(sourceId);
  state.lastUpdate = new Date().toISOString();
  writeData(state.items);
  console.log(`[reset-source] ${sourceId}: rimossi ${removed} necrologi`);
  res.json({ ok: true, removed, last_update: state.lastUpdate });
});

app.post("/refresh-source/:sourceId", async (req, res) => {
  const sourceId = (req.params.sourceId || "").toString().trim();
  if (!sourceId || !SOURCES.find((s) => s.id === sourceId)) {
    return res.status(400).json({ ok: false, error: "Invalid source ID" });
  }

  const result = await refreshSource(sourceId);
  res.json({
    ...result,
    last_update: state.lastUpdate,
  });
});

app.get("/refresh-source-stream/:sourceId", (req, res) => {
  const sourceId = (req.params.sourceId || "").toString().trim();
  const source = SOURCES.find((s) => s.id === sourceId);
  
  if (!sourceId || !source) {
    return res.status(400).json({ ok: false, error: "Invalid source ID" });
  }

  if (state.running) {
    return res.status(409).json({ ok: false, error: "Already scanning" });
  }

  state.running = true;
  state.lastError = null;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  (async () => {
    try {
      const previousItems = state.items;
      const forceReprocess = state.forceReprocessSources.has(sourceId);
      if (forceReprocess) {
        console.info(`[scraper] Forzato reprocess senza cache (stream): source=${source.id}`);
      }
      sendEvent("start", { source: source.label, status: "Inizio scansione..." });

      let sourceItems = await scrapeSource(source, config, (progress) => {
        sendEvent("progress", {
          current: progress.current,
          total: progress.total,
          title: progress.title,
          count: progress.count,
          percent: Math.round((progress.current / progress.total) * 100),
        });
      }, forceReprocess ? [] : previousItems);

      sendEvent("persist", { status: "Download immagini..." });

      if (config.save_images) {
        sourceItems = await persistImages(sourceItems);
      }

      sendEvent("merge", { status: "Merge con dati precedenti..." });

      const sourceUrlSet = new Set(sourceItems.map((item) => item.id));
      const otherItems = state.items.filter((item) => !sourceUrlSet.has(item.id));

      const merged = [...sourceItems, ...otherItems].sort((a, b) => {
        const aDate = dateToSortableNumber(a.data_funerale);
        const bDate = dateToSortableNumber(b.data_funerale);
        return bDate - aDate;
      });

      state.items = merged;
      state.lastUpdate = new Date().toISOString();
      writeData(merged);
      await publishMqttUpdate({
        config,
        items: state.items,
        updatedAt: state.lastUpdate,
        newItems: getNewItems(previousItems, state.items),
      });
      if (forceReprocess) {
        state.forceReprocessSources.delete(sourceId);
      }

      sendEvent("complete", {
        ok: true,
        count: sourceItems.length,
        source: source.label,
        last_update: state.lastUpdate,
      });

      res.end();
    } catch (error) {
      state.lastError = error.message;
      console.error(`[refresh-stream] Errore ${source.label}:`, error);
      sendEvent("error", {
        ok: false,
        error: error.message,
      });
      res.end();
    } finally {
      state.running = false;
    }
  })();
});

app.listen(config.listen_port, async () => {
  console.log(`[server] Necrologi add-on in ascolto su porta ${config.listen_port}`);
  await initMqtt(config);
  await refreshData();
  const intervalMs = Math.max(10, Number(config.scan_interval_minutes || 60)) * 60 * 1000;
  setInterval(refreshData, intervalMs);
  console.log(`[server] Refresh schedulato ogni ${config.scan_interval_minutes} minuti`);
});
