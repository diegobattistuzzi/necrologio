const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeText, extractFuneralDate } = require("./utils");

const AI_CACHE_FILE = path.join("/data", "ai_cache.json");
const AI_CACHE_MAX_ENTRIES = 2000;
let aiCache = null;

function loadAiCache() {
  if (aiCache) {
    return aiCache;
  }

  try {
    if (!fs.existsSync(AI_CACHE_FILE)) {
      aiCache = {};
      return aiCache;
    }

    const raw = fs.readFileSync(AI_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    aiCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    aiCache = {};
  }

  return aiCache;
}

function saveAiCache() {
  try {
    const cache = loadAiCache();
    const keys = Object.keys(cache);
    if (keys.length > AI_CACHE_MAX_ENTRIES) {
      // Mantiene solo le voci piu recenti per non far crescere troppo il file.
      const recent = keys
        .map((k) => ({ key: k, ts: Number(cache[k]?.saved_at || 0) }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, AI_CACHE_MAX_ENTRIES);

      const pruned = {};
      for (const item of recent) {
        pruned[item.key] = cache[item.key];
      }
      aiCache = pruned;
    }

    fs.writeFileSync(AI_CACHE_FILE, JSON.stringify(aiCache, null, 2), "utf8");
  } catch {
    // Se la cache non e scrivibile, continuiamo senza bloccare lo scraping.
  }
}

function buildAiCacheKey(text) {
  const normalized = cleanNecrologioText(text).slice(0, 6000);
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function getCachedAiResult(text) {
  const cache = loadAiCache();
  const key = buildAiCacheKey(text);
  const value = cache[key];
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    parenti: normalizeText(value.parenti || "") || null,
    luogo_funerale: normalizeText(value.luogo_funerale || "") || null,
    data_funerale: normalizeText(value.data_funerale || "") || null,
    rosario: normalizeText(value.rosario || "") || null,
    anni: Number.isFinite(Number(value.anni)) ? Number(value.anni) : null,
  };
}

function setCachedAiResult(text, result) {
  const cache = loadAiCache();
  const key = buildAiCacheKey(text);
  cache[key] = {
    parenti: normalizeText(result?.parenti || "") || null,
    luogo_funerale: normalizeText(result?.luogo_funerale || "") || null,
    data_funerale: normalizeText(result?.data_funerale || "") || null,
    rosario: normalizeText(result?.rosario || "") || null,
    anni: Number.isFinite(Number(result?.anni)) ? Number(result.anni) : null,
    saved_at: Date.now(),
  };
  saveAiCache();
}

function extractParentsFromText(text) {
  const value = normalizeText(text);
  if (!value) {
    return null;
  }

  const match = value.match(
    /(ne danno il triste annuncio|a darne il triste annuncio|annunciano con dolore|lasciano nel dolore)([^.]{0,280})/i
  );

  if (!match) {
    return null;
  }

  return normalizeText(match[2]).replace(/^(la|i|gli)\s+/i, "").replace(/(i funerali|le esequie|il rosario).*$/i, "").trim() || null;
}

function extractFuneralPlaceFromText(text) {
  const value = normalizeText(text);
  if (!value) {
    return null;
  }

  const match = value.match(
    /(i funerali|le esequie|la cerimonia funebre)[^.]{0,220}?(?:presso|nella|nel|alla|al)\s+([^.;,\n]{4,180})/i
  );

  return match ? normalizeText(match[2]) : null;
}

function extractRosaryFromText(text) {
  const value = normalizeText(text);
  if (!value) {
    return null;
  }

  const match = value.match(/(il\s+rosario[^.\n]{0,220})/i);
  return match ? normalizeText(match[1]) : null;
}

function extractAgeFromText(text) {
  const value = normalizeText(text);
  if (!value) {
    return null;
  }

  const patterns = [
    /\bdi\s+anni\s+(\d{1,3})\b/i,
    /\bdi\s+(\d{1,3})\s+anni\b/i,
    /\banni\s+(\d{1,3})\b/i,
    /\beta\s+(\d{1,3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      const age = Number(match[1]);
      if (age >= 1 && age <= 120) {
        return age;
      }
    }
  }

  return null;
}

function parseJsonFromAiText(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const direct = text.match(/\{[\s\S]*\}/);
  if (!direct) {
    return null;
  }

  try {
    return JSON.parse(direct[0]);
  } catch {
    return null;
  }
}

function cleanNecrologioText(text) {
  if (!text) return "";

  return text
    // Rimuove script JavaScript e stili CSS
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
    // Rimuove blocchi JSON (come quello di prefetch o dei cookie nel tuo esempio)
    .replace(/\{[\s\S]*?\}/g, "")
    // Rimuove commenti HTML
    .replace(/<!--[\s\S]*?-->/g, "")
    // Rimuove i testi tipici della privacy/cookie policy
    .replace(/(Utilizziamo i cookie|cookie classified as|Necessary cookies|cookielawinfo)[\s\S]*/gi, "")
    // Rimuove spazi e linee vuote multiple
    .replace(/\s\s+/g, ' ')
    .trim();
}

function formatAiHttpError(error) {
  const status = error?.response?.status;
  const statusText = normalizeText(error?.response?.statusText || "");
  const message = normalizeText(error?.message || "Errore sconosciuto");
  const responseData = error?.response?.data;

  let payload = "";
  if (responseData !== undefined) {
    if (typeof responseData === "string") {
      payload = responseData;
    } else {
      try {
        payload = JSON.stringify(responseData);
      } catch {
        payload = String(responseData);
      }
    }
  }

  const parts = [message];
  if (status) {
    parts.push(`status=${status}`);
  }
  if (statusText) {
    parts.push(`statusText=${statusText}`);
  }
  if (payload) {
    parts.push(`response=${payload}`);
  }

  return parts.join(" | ");
}

function logAiSkipped(reason, details) {
  const suffix = details ? ` | ${details}` : "";
  console.debug(`[ai] Chiamata evitata: ${reason}${suffix}`);
}

async function extractWithHomeAssistantAi(text, options) {
  const supervisorToken = normalizeText(process.env.SUPERVISOR_TOKEN || "");
  const configuredHaToken = normalizeText(options.ha_access_token || "");
  const authToken = configuredHaToken || supervisorToken;
  if (!authToken) {
    console.warn("[ai] Nessun token disponibile (ha_access_token/SUPERVISOR_TOKEN): salto AI.");
    return null;
  }


  const apiUrl = (options.ha_api_url || "http://supervisor/core/api").replace(/\/+$/, "");
  const timeoutMs = Math.max(3000, Number(options.ai_timeout_ms || 15000));
  const payload = {
    text:
      "Estrai da questo annuncio funebre SOLO JSON valido senza spiegazioni con chiavi: " +
      'parenti, luogo_funerale, data_funerale, rosario, anni (eta del defunto come numero intero, vuoto se non disponibile). Usa stringa vuota se non disponibile. Testo: "' +
      cleanNecrologioText(text).slice(0, 6000) +
      '"',
    language: "it",

  };

  if (options.ai_agent_id) {
    payload.agent_id = options.ai_agent_id;
  }

  const headers = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // In alcuni setup Supervisor richiede anche questo header esplicito.
  if (!configuredHaToken && supervisorToken) {
    headers["X-Supervisor-Token"] = supervisorToken;
  }

  console.debug(`[ai] Invio richiesta a Home Assistant conversation.process con payload: ${JSON.stringify(payload)}`);

  const response = await axios.post(`${apiUrl}/conversation/process`, payload, {
    timeout: timeoutMs,
    headers,
  });

  try {
    console.debug(`[ai] Risposta completa Home Assistant: ${JSON.stringify(response?.data || {})}`);
  } catch {
    console.debug("[ai] Risposta completa Home Assistant: [non serializzabile]");
  }

  const speech = response?.data?.response?.speech?.plain?.speech || "";
  console.debug(`[ai] Speech AI: ${speech}`);
  const parsed = parseJsonFromAiText(speech);
  if (!parsed) {
    return null;
  }

  const anniRaw = parsed.anni;
  const anni = anniRaw && String(anniRaw).trim() !== "" ? (Number(anniRaw) || null) : null;

  return {
    parenti: normalizeText(parsed.parenti || "") || null,
    luogo_funerale: normalizeText(parsed.luogo_funerale || "") || null,
    data_funerale: normalizeText(parsed.data_funerale || "") || null,
    rosario: normalizeText(parsed.rosario || "") || null,
    anni,
  };
}

async function extractAnnouncementDetails(bodyText, options, aiState) {
  const heuristics = {
    parenti: extractParentsFromText(bodyText),
    luogo_funerale: extractFuneralPlaceFromText(bodyText),
    data_funerale: extractFuneralDate(bodyText),
    rosario: extractRosaryFromText(bodyText),
    anni: extractAgeFromText(bodyText),
  };

  const needsAiData =
    !options.ai_only_when_missing ||
    !heuristics.parenti ||
    !heuristics.luogo_funerale ||
    !heuristics.rosario ||
    !heuristics.data_funerale ||
    !heuristics.anni;

  if (!options.enable_ai_extraction) {
    logAiSkipped("ai_disabilitata");
    return { ...heuristics, ai_used: false };
  }

  if (!needsAiData) {
    logAiSkipped("heuristics_sufficienti");
    return { ...heuristics, ai_used: false };
  }

  const cachedAi = getCachedAiResult(bodyText);
  if (cachedAi) {
    logAiSkipped("cache_hit");
    return {
      parenti: heuristics.parenti || cachedAi.parenti,
      luogo_funerale: heuristics.luogo_funerale || cachedAi.luogo_funerale,
      data_funerale: heuristics.data_funerale || cachedAi.data_funerale,
      rosario: heuristics.rosario || cachedAi.rosario,
      anni: heuristics.anni || cachedAi.anni || null,
      ai_used: false,
    };
  }

  if (aiState.authFailed) {
    logAiSkipped("auth_failed_in_run");
    return { ...heuristics, ai_used: false };
  }

  if (aiState.used >= options.ai_max_items_per_run) {
    logAiSkipped("budget_esaurito", `used=${aiState.used} max=${options.ai_max_items_per_run}`);
    return { ...heuristics, ai_used: false };
  }

  const shouldUseAi =
    options.enable_ai_extraction &&
    !aiState.authFailed &&
    aiState.used < options.ai_max_items_per_run &&
    needsAiData;

  if (!shouldUseAi) {
    return { ...heuristics, ai_used: false };
  }

  try {
    const aiData = await extractWithHomeAssistantAi(bodyText, options);
    aiState.used += 1;

    if (!aiData) {
      return { ...heuristics, ai_used: true };
    }

    setCachedAiResult(bodyText, aiData);

    return {
      parenti: heuristics.parenti || aiData.parenti,
      luogo_funerale: heuristics.luogo_funerale || aiData.luogo_funerale,
      data_funerale: heuristics.data_funerale || aiData.data_funerale,
      rosario: heuristics.rosario || aiData.rosario,
      anni: heuristics.anni || aiData.anni || null,
      ai_used: true,
    };
  } catch (error) {
    if (error?.response?.status === 401) {
      // Evita errori ripetuti: se l'autenticazione fallisce una volta, salta AI per il resto della run.
      if (!aiState.authFailed) {
        console.warn("[ai] Errore autenticazione (401) verso Home Assistant conversation.process: disattivo AI per questa scansione.");
      }
      aiState.authFailed = true;
      return { ...heuristics, ai_used: false };
    }

    if (error?.response?.status === 400) {
      console.warn(`[ai] Errore estrazione AI (400): ${formatAiHttpError(error)}`);
      return { ...heuristics, ai_used: false };
    }

    console.warn(`[ai] Errore estrazione AI: ${formatAiHttpError(error)}`);
    return { ...heuristics, ai_used: false };
  }
}

module.exports = {
  extractAnnouncementDetails,
};
