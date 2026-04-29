const express = require("express");
const { loadConfig } = require("./config");
const { scrapeAll, scrapeSource, SOURCES } = require("./scraper");
const { readData, writeData } = require("./storage");
const { SHARE_IMAGES_DIR, persistImages } = require("./images");
const { dateToSortableNumber } = require("./utils");
const { initMqtt, publishMqttUpdate } = require("./mqtt");

const app = express();
app.use(express.json());
app.use("/images", express.static(SHARE_IMAGES_DIR));

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSummaryPage(items, updatedAt, includeHidden, hiddenCount) {
  const groupsBySourceId = new Map();
  
  for (const item of items) {
    const sourceIdKey = item.source_id || "sconosciuta";
    if (!groupsBySourceId.has(sourceIdKey)) {
      groupsBySourceId.set(sourceIdKey, { items: [], label: item.source || "Sconosciuta" });
    }
    groupsBySourceId.get(sourceIdKey).items.push(item);
  }
  
  const sourceSummary = Array.from(groupsBySourceId.entries())
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .map(
      ([sourceId, { items: sourceItems, label }]) =>
        `<li><strong>${escapeHtml(label)}</strong>: ${sourceItems.length} <button class="btn-rescan" data-source-id="${escapeHtml(sourceId)}" title="Rescan ${escapeHtml(label)}">🔄</button></li>`
    )
    .join("\n");

  const sortedItems = [...items].sort(
    (a, b) => dateToSortableNumber(b.data_funerale) - dateToSortableNumber(a.data_funerale)
  );

  const cards = sortedItems
    .map((item) => {
      const imageSrc = item.foto_api_url
        ? escapeHtml(item.foto_api_url.replace(/^\/+/, ""))
        : "";
      const photo = item.foto_api_url
        ? `<img src="${imageSrc}" alt="${escapeHtml(item.full_name)}" loading="lazy" />`
        : `<div class="no-photo">Foto non disponibile</div>`;

      const date = item.data_funerale ? escapeHtml(item.data_funerale) : "n.d.";
      const age = Number.isFinite(Number(item.anni)) ? String(Number(item.anni)) : "n.d.";
      const parenti = item.parenti ? `<p><strong>Parenti:</strong> ${escapeHtml(item.parenti)}</p>` : "";
      const luogoFunerale = item.luogo_funerale ? `<p><strong>Luogo funerale:</strong> ${escapeHtml(item.luogo_funerale)}</p>` : "";
      const rosario = item.rosario ? `<p><strong>Rosario:</strong> ${escapeHtml(item.rosario)}</p>` : "";
      const link = item.obituary_url ? `<a href="${escapeHtml(item.obituary_url)}" target="_blank" rel="noreferrer">Apri annuncio</a>` : "";
      const sourceBadge = `<div class="source-badge">${escapeHtml(item.source || item.source_id || "Sorgente sconosciuta")}</div>`;

      return `
        <article class="card">
          <div class="media">${photo}</div>
          <div class="content">
            ${sourceBadge}
            <h3>${escapeHtml(item.full_name)}</h3>
            <p><strong>Data funerale:</strong> ${date}</p>
            <p><strong>Età:</strong> ${escapeHtml(age)}</p>
            <p><strong>Paese:</strong> ${escapeHtml(item.paese || "n.d.")}</p>
            <p><strong>Nome:</strong> ${escapeHtml(item.nome || "")}</p>
            <p><strong>Cognome:</strong> ${escapeHtml(item.cognome || "")}</p>
            ${parenti}
            ${luogoFunerale}
            ${rosario}
            ${link}
          </div>
        </article>
      `;
    })
    .join("\n");

  const sections = `
    <section>
      <h2>Epigrafi per data <span>${sortedItems.length}</span></h2>
      <div class="grid">${cards}</div>
    </section>
  `;

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Necrologi Zona TV</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f1ec;
      --panel: #ffffff;
      --ink: #1e242b;
      --muted: #5e6873;
      --accent: #8c2f39;
      --line: #d7d2ca;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at 20% 0%, #faf9f5, var(--bg));
      color: var(--ink);
      font: 16px/1.4 "Segoe UI", Tahoma, sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 20;
      backdrop-filter: blur(4px);
      background: rgba(243, 241, 236, 0.9);
      border-bottom: 1px solid var(--line);
      padding: 14px 18px;
    }
    header h1 {
      margin: 0;
      font-size: 1.2rem;
      letter-spacing: 0.02em;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    header p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .btn-toggle-old {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-toggle-old:hover {
      border-color: #b8b0a5;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    section { margin-bottom: 28px; }
    section h2 {
      margin: 0 0 10px;
      font-size: 1.05rem;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    section h2 span {
      color: var(--muted);
      font-weight: 500;
      font-size: 0.9rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .card {
      display: grid;
      grid-template-columns: 96px 1fr;
      gap: 10px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    }
    .media {
      width: 96px;
      height: 120px;
      border-radius: 8px;
      overflow: hidden;
      background: #ece8e1;
      border: 1px solid var(--line);
    }
    .media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .no-photo {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 0.75rem;
      color: var(--muted);
      padding: 6px;
    }
    .content h3 {
      margin: 0 0 6px;
      font-size: 0.98rem;
      line-height: 1.25;
    }
    .source-badge {
      display: inline-block;
      margin: 0 0 8px;
      padding: 4px 8px;
      border-radius: 999px;
      background: #f7e3d2;
      color: #7c2d12;
      border: 1px solid #edc4a5;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .content p {
      margin: 0 0 4px;
      font-size: 0.87rem;
    }
    .content a {
      display: inline-block;
      margin-top: 6px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
      font-size: 0.87rem;
    }
    .content a:hover { text-decoration: underline; }
    .empty {
      background: var(--panel);
      border: 1px dashed var(--line);
      border-radius: 12px;
      padding: 18px;
      color: var(--muted);
    }
    .summary-box {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .summary-box summary {
      list-style: none;
      cursor: pointer;
      padding: 14px 16px;
      font-size: 0.95rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .summary-box summary::-webkit-details-marker {
      display: none;
    }
    .summary-box summary::after {
      content: "▾";
      color: var(--muted);
      font-size: 0.9rem;
      transition: transform 0.2s ease;
    }
    .summary-box[open] summary::after {
      transform: rotate(180deg);
    }
    .summary-content {
      padding: 0 16px 14px;
      border-top: 1px solid var(--line);
    }
    .summary-box ul {
      list-style: none;
      padding: 0;
      margin: 10px 0 0;
    }
    .summary-box li {
      font-size: 0.87rem;
      margin: 0 0 4px;
      padding: 4px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .btn-rescan {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background-color 0.2s;
    }
    .btn-rescan:hover {
      background-color: rgba(0, 0, 0, 0.08);
    }
    .btn-rescan.loading {
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .progress-container {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    .progress-container.active {
      display: flex;
    }
    .progress-modal {
      background: var(--panel);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }
    .progress-modal h3 {
      margin: 0 0 16px;
      font-size: 1.05rem;
    }
    .progress-bar-wrapper {
      margin-bottom: 12px;
    }
    .progress-bar {
      width: 100%;
      height: 24px;
      background: #ece8e1;
      border-radius: 8px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #45a049);
      width: 0%;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      color: white;
      font-weight: 600;
    }
    .progress-info {
      font-size: 0.87rem;
      color: var(--muted);
      line-height: 1.4;
    }
    .progress-info strong {
      color: var(--ink);
    }
  </style>
</head>
<body>
  <header>
    <div class="header-row">
      <h1>Necrologi Zona TV</h1>
      <button id="toggleOldBtn" class="btn-toggle-old" data-include-hidden="${includeHidden ? "true" : "false"}">
        ${includeHidden ? "Nascondi i vecchi" : "Mostra i vecchi"}
      </button>
    </div>
    <p>Aggiornato: ${escapeHtml(updatedAt || "mai")}</p>
    <p>Necrologi vecchi nascosti: ${Number(hiddenCount || 0)}</p>
  </header>
  <main>
    <details class="summary-box" open>
      <summary>
        <span>📊 Riepilogo per sorgente</span>
        <span>${groupsBySourceId.size} sorgenti</span>
      </summary>
      <div class="summary-content">
        <ul>${sourceSummary || '<li>Nessun dato disponibile</li>'}</ul>
      </div>
    </details>
    ${sections || '<div class="empty">Nessun necrologio disponibile al momento.</div>'}
  </main>
  <div id="progressContainer" class="progress-container">
    <div class="progress-modal">
      <h3 id="progressTitle">Scansione...</h3>
      <div class="progress-bar-wrapper">
        <div class="progress-bar">
          <div class="progress-bar-fill" id="progressBarFill">0%</div>
        </div>
      </div>
      <div class="progress-info" id="progressInfo">
        <div><strong>0</strong> / <strong id="progressTotal">0</strong> trovati</div>
        <div style="margin-top: 6px;" id="progressTitle2">Contattando sorgente...</div>
      </div>
    </div>
  </div>
  <script>
    const toggleOldBtn = document.getElementById('toggleOldBtn');
    if (toggleOldBtn) {
      toggleOldBtn.addEventListener('click', () => {
        const includeHidden = toggleOldBtn.dataset.includeHidden === 'true';
        const url = new URL(window.location.href);
        if (includeHidden) {
          url.searchParams.delete('include_hidden');
        } else {
          url.searchParams.set('include_hidden', 'true');
        }
        window.location.href = url.toString();
      });
    }

    document.querySelectorAll('.btn-rescan').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const sourceId = btn.dataset.sourceId;
        if (!sourceId) return;

        const progressContainer = document.getElementById('progressContainer');
        const progressTitle = document.getElementById('progressTitle');
        const progressBarFill = document.getElementById('progressBarFill');
        const progressInfo = document.getElementById('progressInfo');
        const progressTitle2 = document.getElementById('progressTitle2');

        progressContainer.classList.add('active');
        btn.disabled = true;

        const eventSource = new EventSource('/refresh-source-stream/' + sourceId);
        let hasError = false;

        eventSource.addEventListener('start', (e) => {
          const data = JSON.parse(e.data);
          progressTitle.textContent = 'Scansione: ' + data.source;
        });

        eventSource.addEventListener('progress', (e) => {
          const data = JSON.parse(e.data);
          progressBarFill.style.width = data.percent + '%';
          progressBarFill.textContent = data.percent + '%';
          progressInfo.innerHTML = '<div><strong>' + data.count + '</strong> trovati</div><div style="margin-top: 6px;">📄 ' + data.title + '</div>';
          document.getElementById('progressTotal').textContent = data.total;
        });

        eventSource.addEventListener('persist', (e) => {
          const data = JSON.parse(e.data);
          progressTitle2.textContent = data.status;
          progressBarFill.style.width = '100%';
          progressBarFill.textContent = '...';
        });

        eventSource.addEventListener('merge', (e) => {
          const data = JSON.parse(e.data);
          progressTitle2.textContent = data.status;
        });

        eventSource.addEventListener('complete', (e) => {
          const data = JSON.parse(e.data);
          if (data.ok) {
            progressBarFill.style.background = '#4CAF50';
            progressTitle.textContent = '✓ Completato';
            progressTitle2.textContent = data.count + ' necrologi caricati';
            setTimeout(() => {
              eventSource.close();
              window.location.reload();
            }, 1500);
          } else {
            hasError = true;
            progressTitle.textContent = '✗ Errore';
            progressTitle2.textContent = data.error;
          }
        });

        eventSource.addEventListener('error', (e) => {
          eventSource.close();
          hasError = true;
          progressTitle.textContent = '✗ Errore';
          try {
            const data = JSON.parse(e.data);
            progressTitle2.textContent = data.error;
          } catch {
            progressTitle2.textContent = 'Errore durante la scansione';
          }
          
          setTimeout(() => {
            progressContainer.classList.remove('active');
            btn.disabled = false;
          }, 2000);
        });
      });
    });
  </script>
</body>
</html>`;
}

let state = {
  lastUpdate: null,
  running: false,
  items: readData(),
  lastError: null,
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
    let sourceItems = await scrapeSource(source, config, null, previousItems);

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
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderSummaryPage(itemsToShow, state.lastUpdate, includeHidden, hiddenCount));
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
      sendEvent("start", { source: source.label, status: "Inizio scansione..." });

      let sourceItems = await scrapeSource(source, config, (progress) => {
        sendEvent("progress", {
          current: progress.current,
          total: progress.total,
          title: progress.title,
          count: progress.count,
          percent: Math.round((progress.current / progress.total) * 100),
        });
      }, previousItems);

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
