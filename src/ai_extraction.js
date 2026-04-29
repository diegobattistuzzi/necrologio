const axios = require("axios");
const { normalizeText, extractFuneralDate } = require("./utils");

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

async function extractWithHomeAssistantAi(text, options) {
  const supervisorToken = process.env.SUPERVISOR_TOKEN;
  if (!supervisorToken) {
    return null;
  }

  const apiUrl = (options.ha_api_url || "http://supervisor/core/api").replace(/\/+$/, "");
  const timeoutMs = Math.max(3000, Number(options.ai_timeout_ms || 15000));
  const payload = {
    text:
      "Estrai da questo annuncio funebre SOLO JSON valido senza spiegazioni con chiavi: " +
      'parenti, luogo_funerale, data_funerale, rosario, anni (eta del defunto come numero intero, vuoto se non disponibile). Usa stringa vuota se non disponibile. Testo: "' +
      normalizeText(text).slice(0, 6000) +
      '"',
    language: "it",
  };

  if (options.ai_agent_id) {
    payload.agent_id = options.ai_agent_id;
  }

  const response = await axios.post(`${apiUrl}/conversation/process`, payload, {
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${supervisorToken}`,
      "Content-Type": "application/json",
    },
  });

  const speech = response?.data?.response?.speech?.plain?.speech || "";
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

  const shouldUseAi =
    options.enable_ai_extraction &&
    aiState.used < options.ai_max_items_per_run &&
    (!options.ai_only_when_missing || !heuristics.parenti || !heuristics.luogo_funerale || !heuristics.rosario || !heuristics.data_funerale || !heuristics.anni);

  if (!shouldUseAi) {
    return { ...heuristics, ai_used: false };
  }

  try {
    const aiData = await extractWithHomeAssistantAi(bodyText, options);
    aiState.used += 1;

    if (!aiData) {
      return { ...heuristics, ai_used: true };
    }

    return {
      parenti: heuristics.parenti || aiData.parenti,
      luogo_funerale: heuristics.luogo_funerale || aiData.luogo_funerale,
      data_funerale: heuristics.data_funerale || aiData.data_funerale,
      rosario: heuristics.rosario || aiData.rosario,
      anni: heuristics.anni || aiData.anni || null,
      ai_used: true,
    };
  } catch (error) {
    console.warn(`[ai] Errore estrazione AI: ${error.message}`);
    return { ...heuristics, ai_used: false };
  }
}

module.exports = {
  extractAnnouncementDetails,
};
