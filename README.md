# Add-on Home Assistant: Necrologi Zona TV

Questo add-on esegue scraping dei necrologi dai siti:

- https://www.servizisalvador.it/necrologi/
- https://ultimoviaggio.it/necrologi/
- https://www.onoranzefunebrimemorial.it/necrologi/
- https://onoranzefunebrisanosvaldo.it/necrologi/
- https://www.pfasanmarco.it/annunci-funebri/

Filtra i risultati in base ai paesi configurati (default: Orsago, Cordignano, Godega, San Fior) e salva:

- nome
- cognome
- foto
- paese
- data funerale (quando individuata)

Inoltre, quando `save_images: true`, scarica le immagini in locale.

## API esposta

Porta: `8099`

- `GET /health`
- `GET /obituaries`
- `GET /obituaries?town=Orsago`
- `GET /obituaries/latest?limit=10`
- `POST /refresh`

Le immagini salvate sono pubblicate anche tramite:

- `GET /images/<nome_file>`

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
towns:
  - Orsago
  - Cordignano
  - Godega
  - San Fior
log_level: info
```

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

## Note importanti

- I layout dei siti possono cambiare: i selettori di scraping potrebbero richiedere aggiornamenti.
- Verifica sempre policy/termini d'uso dei siti sorgente prima dell'uso continuativo.
- La data funerale non e sempre presente in forma strutturata: in quel caso puo risultare vuota.
