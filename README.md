# Add-on Home Assistant: Necrologi Zona TV

Questo add-on esegue scraping dei necrologi dai siti:

- https://www.servizisalvador.it/necrologi/
- https://ultimoviaggio.it/necrologi/
- https://www.onoranzefunebrimemorial.it/necrologi/
- https://onoranzefunebrisanosvaldo.it/necrologi/
- https://www.pfasanmarco.it/annunci-funebri/
- https://www.onoranzefunebrizanette.it/necrologi-cordogli-online-cordignano
- https://www.pompefunebrisalamon.com/condoglianze-online/
- https://www.onoranzefunebrilapaceconegliano.com/annunci-funebri/
- https://www.agenziafunebrezanardo.it/condoglianze-online/
- https://www.ofroman.com/lista-annunci-db.php

Filtra i risultati in base ai paesi configurati (default: Orsago, Cordignano, Godega, San Fior) e salva:

- nome
- cognome
- foto
- paese
- data funerale (quando individuata)
- parenti (quando individuati)
- luogo funerale (quando individuato)
- rosario (quando individuato)

Inoltre, quando `save_images: true`, scarica le immagini in locale.

Quando `enable_ocr: true`, applica OCR locale come fallback (attualmente su Ultimo Viaggio, Zanette, Servizi Salvador, Salamon, La Pace Conegliano, Zanardo e Roman) per provare a recuperare `paese` e `data_funerale` dai contenuti grafici.

Quando `enable_ai_extraction: true`, usa anche l'agente AI configurato in Home Assistant (API `conversation.process`) per migliorare l'estrazione di:

- `parenti`
- `luogo_funerale`
- `data_funerale`
- `rosario`

Supporta anche MQTT con Home Assistant auto-discovery (sensori automatici).

## API esposta

Porta: `8099`

- `GET /health`
- `GET /obituaries`
- `GET /obituaries?town=Orsago`
- `GET /obituaries/latest?limit=10`
- `POST /refresh` - Rescan di tutte le sorgenti
- `POST /refresh-source/:sourceId` - Rescan di una singola sorgente

Il parametro `sourceId` può essere uno di:
  - `servizi_salvador`
  - `ultimoviaggio`
  - `memorial`
  - `san_osvaldo`
  - `pfa_san_marco`
  - `zanette`
  - `salamon`
  - `lapace_conegliano`
  - `zanardo`
  - `roman`

Le immagini salvate sono pubblicate anche tramite:

- `GET /images/<nome_file>`

## Interfaccia web riepilogo

L'add-on espone una pagina HTML leggibile anche da smartphone:

- `GET /`
- `GET /web`

Con Ingress abilitato, l'interfaccia e anche apribile direttamente dentro Home Assistant.

La pagina mostra:

- **Riepilogo per sorgente**: numero di necrologi per ogni sorgente, con bottone 🔄 per rescan rapido singola sorgente
- **Necrologi raggruppati per paese**: foto, nome, cognome, data funerale e link all'annuncio originale

Cliccando sul bottone 🔄 accanto a una sorgente, esegui il rescan solo di quella sorgente (più veloce che rescan completo).

Esempio URL:

- `http://IP_DEL_TUO_HA:8099/web`

## Voce nella barra laterale di Home Assistant

1. Apri Add-ons -> Necrologi Zona TV.
2. Vai nella scheda Informazioni.
3. Attiva Mostra nella barra laterale.
4. Salva e riapri Home Assistant.

Troverai la nuova voce in sidebar con titolo "Necrologi Zona TV".

## File esportato

Oltre al file interno `/data/obituaries.json`, l'add-on prova anche a scrivere:

- `/share/necrologi.json`
- `/share/necrologi_images/*`

Così Home Assistant può leggere i dati anche dal filesystem condiviso.

## Installazione (add-on locale)

1. Copia questa cartella dentro la directory add-ons locale di Home Assistant.
2. Riavvia Home Assistant.
3. Vai in Impostazioni -> Add-ons -> Repository locali e aggiungi la cartella se necessario.
4. Installa e avvia l'add-on `Necrologi Zona TV`.

## Configurazione add-on

Esempio opzioni:

```yaml
scan_interval_minutes: 60
max_items_per_source: 80
save_images: true
enable_ocr: false
ocr_only_when_missing: true
ocr_max_items_per_run: 20
mqtt_enabled: false
mqtt_url: mqtt://core-mosquitto:1883
mqtt_username: ""
mqtt_password: ""
mqtt_base_topic: necrologi_zona_tv
mqtt_discovery_prefix: homeassistant
enable_ai_extraction: false
ai_agent_id: ""
ai_only_when_missing: true
ai_max_items_per_run: 20
ai_timeout_ms: 15000
ha_api_url: http://supervisor/core/api
towns:
  - Orsago
  - Cordignano
  - Godega
  - San Fior
log_level: info
```

## MQTT (sensori automatici in Home Assistant)

Abilita nelle opzioni dell'add-on:

```yaml
mqtt_enabled: true
mqtt_url: mqtt://core-mosquitto:1883
mqtt_username: ""
mqtt_password: ""
mqtt_base_topic: necrologi_zona_tv
mqtt_discovery_prefix: homeassistant
```

Con MQTT abilitato, l'add-on pubblica:

- `necrologi_zona_tv/status` → `online` / `offline` (retained)
- `necrologi_zona_tv/summary` → JSON con totale, aggiornamento, conteggi per sorgente e paese (retained)
- `necrologi_zona_tv/new` → JSON con i nuovi necrologi dell'ultimo refresh (non retained)

### Struttura topic `summary`

```json
{
  "count": 12,
  "updated_at": "2026-04-29T10:00:00.000Z",
  "by_source": {
    "servizi_salvador": 3,
    "ultimoviaggio": 2,
    "memorial": 1,
    "san_osvaldo": 2,
    "pfa_san_marco": 2,
    "zanette": 2
  },
  "by_town": {
    "Orsago": 4,
    "Cordignano": 5,
    "Godega": 2,
    "San Fior": 1
  }
}
```

### Struttura topic `new`

```json
{
  "count": 2,
  "updated_at": "2026-04-29T10:00:00.000Z",
  "items": [
    {
      "id": "zanette:https://...",
      "source": "Onoranze Funebri Zanette",
      "source_id": "zanette",
      "obituary_url": "https://www.onoranzefunebrizanette.it/rossi-mario",
      "full_name": "Rossi Mario",
      "nome": "Rossi",
      "cognome": "Mario",
      "foto": "https://...",
      "paese": "Cordignano",
      "data_funerale": "30/04/2026",
      "parenti": "moglie Lucia, figli Anna e Marco",
      "luogo_funerale": "Chiesa di Cordignano",
      "rosario": null,
      "ai_used": false,
      "ocr_used": true,
      "ocr_confidence": 0.91,
      "scraped_at": "2026-04-29T10:00:00.000Z"
    }
  ]
}
```

### Sensori HA creati via discovery

| Entity ID HA | Nome | Valore |
|---|---|---|
| `sensor.necrologi_totale` | Necrologi Totale | numero totale annunci |
| `sensor.necrologi_ultimo_aggiornamento` | Necrologi Ultimo Aggiornamento | timestamp ISO |
| `sensor.necrologi_servizi_salvador` | Necrologi servizi_salvador | count per sorgente |
| `sensor.necrologi_ultimoviaggio` | Necrologi ultimoviaggio | count per sorgente |
| `sensor.necrologi_memorial` | Necrologi memorial | count per sorgente |
| `sensor.necrologi_san_osvaldo` | Necrologi san_osvaldo | count per sorgente |
| `sensor.necrologi_pfa_san_marco` | Necrologi pfa_san_marco | count per sorgente |
| `sensor.necrologi_zanette` | Necrologi zanette | count per sorgente |
| `sensor.necrologi_orsago` | Necrologi Orsago | count per paese |
| `sensor.necrologi_cordignano` | Necrologi Cordignano | count per paese |
| `sensor.necrologi_godega` | Necrologi Godega | count per paese |
| `sensor.necrologi_san_fior` | Necrologi San Fior | count per paese |

> I sensori per paese dipendono dalla lista `towns` in configurazione. Gli entity ID HA vengono assegnati automaticamente da HA e possono avere un suffisso numerico se già esistenti.

## Estrazione AI con agente Home Assistant

Per usare l'AI definita in Home Assistant:

1. configura un agente conversazionale in HA (OpenAI, Ollama, Azure OpenAI, ecc.)
2. abilita nell'add-on:

```yaml
enable_ai_extraction: true
ai_agent_id: ""
ai_only_when_missing: true
ai_max_items_per_run: 20
ai_timeout_ms: 15000
ha_api_url: http://supervisor/core/api
```

Note:

- `ai_agent_id` vuoto usa l'agente predefinito di HA
- con `ai_only_when_missing: true`, l'AI parte solo quando i campi non sono trovati con regex
- `ai_max_items_per_run` limita il carico dell'agente ad ogni refresh

Note OCR:

- L'OCR e pensato come fallback e puo aumentare tempi/cpu.
- Per limitare carico, usa `ocr_only_when_missing: true`.
- `ocr_max_items_per_run` limita quante epigrafi vengono processate a ogni refresh.
- I record includono `ocr_used` e `ocr_confidence` per debugging.

## Esempio integrazione Home Assistant (REST sensor)

```yaml
sensor:
  - platform: rest
    name: Necrologi Zona TV Count
    resource: http://a0d7b954-necrologi_zona_tv:8099/obituaries
    method: GET
    value_template: "{{ value_json.count }}"
    json_attributes:
      - items
      - updated_at
    scan_interval: 300
```

Nota: il nome host `a0d7b954-necrologi_zona_tv` dipende dallo slug dell'add-on.
Se non risolve, usa l'IP interno del container oppure ingress/rete host.

## Come vedere le info in Home Assistant

1. Avvia l'add-on.
2. Verifica che l'API risponda con:
   - `http://IP_DEL_TUO_HA:8099/health`
   - `http://IP_DEL_TUO_HA:8099/obituaries`
3. Dopo aver aggiunto il sensore REST, vai in Strumenti sviluppatore -> Stati.
4. Cerca l'entita `sensor.necrologi_zona_tv_count`.
5. Negli attributi troverai `items` (lista necrologi) e `updated_at`.

## Esempio card dashboard (Lovelace)

```yaml
type: markdown
content: >
  {% set lista = state_attr('sensor.necrologi_zona_tv_count', 'items') or [] %}
  {% for n in lista[:10] %}
  - {{ n.full_name }} - {{ n.paese }} - {{ n.data_funerale or 'n.d.' }}
  {% endfor %}
```

## Pacchetto completo Home Assistant (sensori + notifiche + card)

Se vuoi una configurazione completa pronta da incollare, crea un package HA
ad esempio in `config/packages/necrologi_zona_tv.yaml`.

```yaml
sensor:
  - platform: rest
    name: Necrologi Zona TV
    unique_id: necrologi_zona_tv_rest
    resource: http://a0d7b954-necrologi_zona_tv:8099/obituaries
    method: GET
    scan_interval: 300
    timeout: 30
    value_template: "{{ value_json.count | int(0) }}"
    json_attributes:
      - items
      - updated_at

template:
  - sensor:
      - name: Necrologi Totale
        unique_id: necrologi_totale
        unit_of_measurement: "annunci"
        state: "{{ states('sensor.necrologi_zona_tv') | int(0) }}"

      - name: Necrologi Ultimo Aggiornamento
        unique_id: necrologi_ultimo_aggiornamento
        state: >
          {{ state_attr('sensor.necrologi_zona_tv', 'updated_at') or 'n.d.' }}

      - name: Necrologi Servizi Salvador
        unique_id: necrologi_source_servizi_salvador
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('source_id', 'equalto', 'servizi_salvador') | list | count }}

      - name: Necrologi Ultimo Viaggio
        unique_id: necrologi_source_ultimoviaggio
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('source_id', 'equalto', 'ultimoviaggio') | list | count }}

      - name: Necrologi Memorial
        unique_id: necrologi_source_memorial
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('source_id', 'equalto', 'memorial') | list | count }}

      - name: Necrologi San Osvaldo
        unique_id: necrologi_source_san_osvaldo
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('source_id', 'equalto', 'san_osvaldo') | list | count }}

      - name: Necrologi PFA San Marco
        unique_id: necrologi_source_pfa_san_marco
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('source_id', 'equalto', 'pfa_san_marco') | list | count }}

      - name: Necrologi Zanette
        unique_id: necrologi_source_zanette
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('source_id', 'equalto', 'zanette') | list | count }}

      - name: Necrologi Orsago
        unique_id: necrologi_town_orsago
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('paese', 'defined') | selectattr('paese', 'equalto', 'Orsago') | list | count }}

      - name: Necrologi Cordignano
        unique_id: necrologi_town_cordignano
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('paese', 'defined') | selectattr('paese', 'equalto', 'Cordignano') | list | count }}

      - name: Necrologi Godega
        unique_id: necrologi_town_godega
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('paese', 'defined') | selectattr('paese', 'equalto', 'Godega') | list | count }}

      - name: Necrologi San Fior
        unique_id: necrologi_town_san_fior
        unit_of_measurement: "annunci"
        state: >
          {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
          {{ items | selectattr('paese', 'defined') | selectattr('paese', 'equalto', 'San Fior') | list | count }}

automation:
  - id: necrologi_notifica_nuovi
    alias: Necrologi - Notifica nuovi annunci
    mode: queued
    trigger:
      - platform: state
        entity_id: sensor.necrologi_zona_tv
    condition:
      - condition: template
        value_template: >
          {{ trigger.from_state is not none and
             (trigger.to_state.state | int(0)) > (trigger.from_state.state | int(0)) }}
    action:
      - variables:
          new_items: >
            {% set old = trigger.from_state.attributes.items | default([], true) %}
            {% set new = trigger.to_state.attributes.items | default([], true) %}
            {% set old_ids = old | map(attribute='id') | list %}
            {{ new | rejectattr('id', 'in', old_ids) | list }}
          txt: >
            {% if new_items | count == 0 %}
              Nuovi necrologi disponibili.
            {% else %}
              {% for n in new_items[:5] %}
              • {{ n.full_name }} - {{ n.paese or 'n.d.' }}{% if n.data_funerale %} - {{ n.data_funerale }}{% endif %}
              {% endfor %}
              {% if (new_items | count) > 5 %}
              ...e altri {{ (new_items | count) - 5 }}
              {% endif %}
            {% endif %}
      - service: persistent_notification.create
        data:
          title: "Necrologi Zona TV"
          message: "{{ txt }}"
      - service: notify.notify
        data:
          title: "Necrologi Zona TV"
          message: "{{ txt }}"
```

### Card dashboard pronta (con immagini e link)

```yaml
type: markdown
title: Necrologi Zona TV
content: >
  {% set base = 'http://a0d7b954-necrologi_zona_tv:8099/' %}
  {% set items = state_attr('sensor.necrologi_zona_tv', 'items') or [] %}
  <style>
    .n-wrap{display:grid;gap:10px}
    .n-card{display:grid;grid-template-columns:72px 1fr;gap:10px;padding:10px;border:1px solid #d7d2ca;border-radius:12px;background:#fff}
    .n-img{width:72px;height:92px;object-fit:cover;border-radius:8px;background:#ece8e1}
    .n-title{font-weight:700;font-size:14px;line-height:1.2}
    .n-meta{font-size:12px;color:#5e6873;margin-top:4px}
    .n-link{display:inline-block;margin-top:6px;padding:4px 8px;border-radius:8px;background:#8c2f39;color:#fff;text-decoration:none;font-size:12px}
  </style>

  <div class="n-wrap">
  {% for n in items[:10] %}
    {% set foto_rel = (n.foto_api_url or '') | regex_replace('^/+', '') %}
    {% set foto = base + foto_rel if foto_rel else '' %}
    <div class="n-card">
      {% if foto %}
        <img class="n-img" src="{{ foto }}" alt="{{ n.full_name }}">
      {% else %}
        <div class="n-img"></div>
      {% endif %}
      <div>
        <div class="n-title">{{ n.full_name }}</div>
        <div class="n-meta">{{ n.paese or 'n.d.' }}{% if n.data_funerale %} • {{ n.data_funerale }}{% endif %}</div>
        {% if n.obituary_url %}
          <a class="n-link" href="{{ n.obituary_url }}" target="_blank" rel="noreferrer">Apri annuncio</a>
        {% endif %}
      </div>
    </div>
  {% endfor %}
  </div>
```

## Note importanti

- I layout dei siti possono cambiare: i selettori di scraping potrebbero richiedere aggiornamenti.
- Verifica sempre policy/termini d'uso dei siti sorgente prima dell'uso continuativo.
- La data funerale non e sempre presente in forma strutturata: in quel caso puo risultare vuota.
