const mqtt = require("mqtt");

let client = null;
let connected = false;
let discoveryPublished = false;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function isMqttEnabled(config) {
  return Boolean(config && config.mqtt_enabled);
}

function getBaseTopic(config) {
  return (config.mqtt_base_topic || "necrologi_zona_tv").replace(/\/+$/, "");
}

function getDiscoveryPrefix(config) {
  return (config.mqtt_discovery_prefix || "homeassistant").replace(/\/+$/, "");
}

function publish(topic, payload, retain) {
  if (!client) {
    console.warn("[mqtt] publish ignorato: client non inizializzato");
    return;
  }
  if (!connected) {
    console.warn(`[mqtt] publish ignorato: non connesso (topic: ${topic})`);
    return;
  }

  const value = typeof payload === "string" ? payload : JSON.stringify(payload);
  client.publish(topic, value, { retain: Boolean(retain), qos: 0 }, (err) => {
    if (err) {
      console.error(`[mqtt] Errore publish su ${topic}: ${err.message}`);
    } else {
      console.debug(`[mqtt] Pubblicato ${topic} (retain=${retain}, len=${value.length})`);
    }
  });
}

function buildSummary(items, updatedAt) {
  const visibleItems = (items || []).filter((item) => item && !item.hidden_old);
  const bySource = {};
  const byTown = {};

  for (const item of visibleItems) {
    const sourceId = item.source_id || "sconosciuta";
    const town = item.paese || "Non specificato";
    bySource[sourceId] = (bySource[sourceId] || 0) + 1;
    byTown[town] = (byTown[town] || 0) + 1;
  }

  return {
    count: visibleItems.length,
    updated_at: updatedAt,
    by_source: bySource,
    by_town: byTown,
  };
}

function publishDiscovery(config, items) {
  if (!client || !connected) {
    console.warn("[mqtt] publishDiscovery saltato: non connesso");
    return;
  }
  if (discoveryPublished) {
    console.debug("[mqtt] Discovery già pubblicata, skip");
    return;
  }

  const discoveryPrefix = getDiscoveryPrefix(config);
  const baseTopic = getBaseTopic(config);
  const stateTopic = `${baseTopic}/summary`;
  const device = {
    identifiers: ["necrologi_zona_tv"],
    name: "Necrologi Zona TV",
    manufacturer: "Custom Add-on",
    model: "Necrologi Scraper",
  };

  const sensors = [
    {
      id: "total",
      name: "Necrologi Totale",
      valueTemplate: "{{ value_json.count }}",
      icon: "mdi:cross",
      unit: "annunci",
    },
    {
      id: "updated_at",
      name: "Necrologi Ultimo Aggiornamento",
      valueTemplate: "{{ value_json.updated_at }}",
      icon: "mdi:clock-outline",
    },
  ];

  for (const sourceId of Object.keys(buildSummary(items, null).by_source)) {
    sensors.push({
      id: `source_${slugify(sourceId)}`,
      name: `Necrologi ${sourceId}`,
      valueTemplate: `{{ value_json.by_source.${sourceId} | default(0) }}`,
      icon: "mdi:web",
      unit: "annunci",
    });
  }

  for (const town of config.towns || []) {
    const townKey = String(town || "");
    sensors.push({
      id: `town_${slugify(townKey)}`,
      name: `Necrologi ${townKey}`,
      valueTemplate: `{{ value_json.by_town['${townKey}'] | default(0) }}`,
      icon: "mdi:map-marker",
      unit: "annunci",
    });
  }

  for (const sensor of sensors) {
    const topic = `${discoveryPrefix}/sensor/necrologi_zona_tv/${sensor.id}/config`;
    const payload = {
      name: sensor.name,
      unique_id: `necrologi_zona_tv_${sensor.id}`,
      state_topic: stateTopic,
      value_template: sensor.valueTemplate,
      icon: sensor.icon,
      device,
    };

    if (sensor.unit) {
      payload.unit_of_measurement = sensor.unit;
    }

    publish(topic, payload, true);
  }

  console.log(`[mqtt] Discovery pubblicata: ${sensors.length} sensori su prefix '${discoveryPrefix}'`);
  discoveryPublished = true;
}

async function initMqtt(config) {
  if (!isMqttEnabled(config)) {
    console.log("[mqtt] Disabilitato (mqtt_enabled=false)");
    return;
  }

  const url = config.mqtt_url || "mqtt://core-mosquitto:1883";
  const baseTopic = getBaseTopic(config);
  const clientId = `necrologi_zona_tv_${Math.random().toString(16).slice(2, 10)}`;
  console.log(`[mqtt] Inizializzazione: url=${url} clientId=${clientId} baseTopic=${baseTopic}`);

  client = mqtt.connect(url, {
    clientId,
    username: config.mqtt_username || undefined,
    password: config.mqtt_password || undefined,
    reconnectPeriod: 5000,
    will: {
      topic: `${baseTopic}/status`,
      payload: "offline",
      retain: true,
    },
  });

  client.on("connect", () => {
    connected = true;
    console.log(`[mqtt] Connesso a ${url}`);
    publish(`${baseTopic}/status`, "online", true);
  });

  client.on("reconnect", () => {
    console.warn(`[mqtt] Tentativo di riconnessione a ${url}...`);
    connected = false;
  });

  client.on("close", () => {
    console.warn("[mqtt] Connessione chiusa");
    connected = false;
  });

  client.on("offline", () => {
    console.warn("[mqtt] Client offline");
  });

  client.on("error", (error) => {
    console.error(`[mqtt] Errore: ${error.message}`);
  });
}

async function publishMqttUpdate({ config, items, updatedAt, newItems }) {
  if (!isMqttEnabled(config)) {
    console.debug("[mqtt] publishMqttUpdate saltato: mqtt disabilitato");
    return;
  }
  if (!client) {
    console.warn("[mqtt] publishMqttUpdate saltato: client non inizializzato");
    return;
  }
  if (!connected) {
    console.warn("[mqtt] publishMqttUpdate saltato: non connesso");
    return;
  }

  const baseTopic = getBaseTopic(config);
  const summary = buildSummary(items, updatedAt);
  console.log(`[mqtt] Pubblicazione update: ${items.length} item, ${newItems ? newItems.length : 0} nuovi`);

  publishDiscovery(config, items);
  publish(`${baseTopic}/summary`, summary, true);

  if (Array.isArray(newItems) && newItems.length > 0) {
    console.log(`[mqtt] Pubblicazione ${newItems.length} nuovi necrologi su ${baseTopic}/new`);
    publish(
      `${baseTopic}/new`,
      {
        count: newItems.length,
        updated_at: updatedAt,
        items: newItems,
      },
      false
    );
  }
}

module.exports = {
  initMqtt,
  publishMqttUpdate,
};
