#!/bin/sh
# Entrypoint do container. Roda em todo start (incluindo restart do Dokploy
# após deploy). Idempotente:
#  - prisma migrate deploy é no-op sem migrations pendentes
#  - seed usa upsert, pode rodar quantas vezes
set -e

echo "[entrypoint] $(date -Iseconds) aplicando migrations..."
npx prisma migrate deploy

echo "[entrypoint] sincronizando seed..."
node ./prisma/seed.mjs

echo "[entrypoint] iniciando Next.js..."
exec node server.js
