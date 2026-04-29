# Add-on Home Assistant: Necrologi Zona TV

Questo add-on esegue scraping dei necrologi dai siti:

- https://www.servizisalvador.it/necrologi/
- https://ultimoviaggio.it/necrologi/
- https://www.onoranzefunebrimemorial.it/necrologi/
- https://onoranzefunebrisanosvaldo.it/necrologi/
- https://www.pfasanmarco.it/annunci-funebri/
- https://www.onoranzefunebrizanette.it/necrologi-cordogli-online-cordignano

Filtra i risultati in base ai paesi configurati (default: Orsago, Cordignano, Godega, San Fior) e salva:

- nome
- cognome
- foto
- paese
- data funerale (quando individuata)

Inoltre, quando `save_images: true`, scarica le immagini in locale.

Quando `enable_ocr: true`, applica OCR locale come fallback (attualmente su Ultimo Viaggio) per provare a recuperare `paese` e `data_funerale` dai contenuti grafici.

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
towns:
  - Orsago
  - Cordignano
  - Godega
  - San Fior
log_level: info
```

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

## Note importanti

- I layout dei siti possono cambiare: i selettori di scraping potrebbero richiedere aggiornamenti.
- Verifica sempre policy/termini d'uso dei siti sorgente prima dell'uso continuativo.
- La data funerale non e sempre presente in forma strutturata: in quel caso puo risultare vuota.
