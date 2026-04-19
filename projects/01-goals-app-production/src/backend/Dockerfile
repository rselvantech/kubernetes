# ── Stage 1: install production dependencies ─────────────────────────────
FROM node:18-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ────────────────────────────────────────────
FROM node:18-alpine
WORKDIR /app

# Non-root user: security best practice — no root process in container
RUN addgroup -g 1001 nodejs && adduser -D -u 1001 -G nodejs nodejs

RUN mkdir -p logs && chown nodejs:nodejs logs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE 80

CMD ["node", "app.js"]