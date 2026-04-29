#!/usr/bin/with-contenv bashio
set -euo pipefail

echo "[necrologi-addon] Avvio servizio..."
node /app/src/index.js
