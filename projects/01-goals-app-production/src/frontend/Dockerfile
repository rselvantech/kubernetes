FROM node:18-alpine AS builder
WORKDIR /app

# Install dependencies first — cached unless package.json changes
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build
# Output: /app/build/ — compiled HTML, JS, CSS (no Node.js needed to serve)

# ── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:1.25-alpine

# Remove the default nginx site configuration
RUN rm /etc/nginx/conf.d/default.conf

# Place our config as a template — envsubst processes ${BACKEND_HOST} at startup
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Copy the compiled React build from Stage 1
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 3000

# The nginx:alpine image entrypoint automatically runs envsubst on templates/
# then starts nginx. No custom CMD needed.
CMD ["nginx", "-g", "daemon off;"]