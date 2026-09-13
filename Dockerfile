# syntax=docker/dockerfile:1.7
# Multi-stage: deps → build → run. Imagem final ~200MB.
# Output standalone do Next.js reduz drasticamente o node_modules embarcado.
#
# Base: node:20-bookworm-slim (Debian). Alpine tem OpenSSL 1.1/3.x misturado
# dependendo da tag e o Prisma engine exige libssl3; bookworm-slim traz
# libssl3 pronto, sem gambiarras de apk add.

ARG NODE_VERSION=20-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Copia manifests e Prisma antes do npm ci para cachear a camada de deps
# quando só o código fonte muda.
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --include=dev

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Heap aumentado: o build do Next com App Router carrega muitas rotas e
# coleta metadata; 2GB evita OOM em hosts com limite baixo.
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npx prisma generate && npm run build

FROM node:${NODE_VERSION} AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Prisma engine exige libssl3; bookworm-slim não vem com openssl instalado.
# Instalamos explicitamente e limpamos o cache do apt para manter a imagem enxuta.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Usuário não-root. Debian-slim tem adduser com --disabled-password.
RUN groupadd --system app && useradd --system --gid app app

# Standalone: Next compila um servidor mínimo + suas deps externas em
# .next/standalone. Copiamos só o que ele precisa pra rodar.
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Prisma: schema, cliente gerado, e o CLI em si (para `prisma migrate deploy`
# rodar no entrypoint). O CLI é devDep mas precisamos dele no runtime.
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=app:app /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=app:app /app/node_modules/.bin ./node_modules/.bin
# Entrypoint + package.json.
COPY --from=build --chown=app:app /app/scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=build --chown=app:app /app/package.json ./package.json

RUN chmod +x /usr/local/bin/entrypoint.sh
USER app

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
