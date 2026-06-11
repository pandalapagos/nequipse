#!/bin/bash
# Azure App Service (Linux) — arranque seguro
set -e
cd /home/site/wwwroot

echo "=== Nequipse startup ==="
echo "Node: $(node -v)"
echo "PORT: ${PORT:-not set}"
echo "PWD: $(pwd)"

if [ ! -d "node_modules/express" ]; then
  echo ">>> node_modules no encontrado, ejecutando npm install..."
  npm install --omit=dev --no-audit --no-fund
fi

echo ">>> Iniciando server.js..."
exec node server.js
