# ────────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile — Node.js production
# ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app

# Usuario no root por seguridad
RUN addgroup -S app && adduser -S app -G app

# tini como init (reaping de procesos zombies, señales correctas)
RUN apk add --no-cache tini wget

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Limpieza
RUN rm -rf .git .vscode tests *.md && chown -R app:app /app

USER app
EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000 \
    TELEGRAM_POLLING=true

ENTRYPOINT ["/sbin/tini", "--"]
# Un proceso por defecto (Telegram + sockets en el mismo worker). Usa cluster.js solo con REDIS_URL.
CMD ["node", "server.js"]
