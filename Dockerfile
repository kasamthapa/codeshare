# ── Stage 1: build the CodeMirror bundle ─────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first (layer-cache friendly)
COPY package*.json ./
COPY build.js ./
COPY src/ ./src/

# Install ALL deps (including devDeps for esbuild + CodeMirror)
RUN npm ci

# Build the minified cm.bundle.js
RUN node build.js

# ── Stage 2: lean production image ───────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only copy production deps manifest, then install without devDeps
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy server and pre-built assets
COPY server.js ./
COPY public/ ./public/
# Copy the bundle built in stage 1 (overwrites any placeholder)
COPY --from=builder /app/public/cm.bundle.js ./public/cm.bundle.js

# Fly.io / Railway expose port via $PORT env var; default 3000
EXPOSE 3000

# Healthcheck so the platform knows when the app is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
