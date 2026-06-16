# Host-portable image for the SharpAPI WebSocket worker.
# Render Background Worker now; drop-in for Fly.io later (no host coupling —
# all configuration is via env vars). Build context = repo root so the worker
# can import the pure lib/ modules it shares with the Next app.
#
#   docker build -f worker/Dockerfile -t oddsphere-stream-worker .
#
# Runs via tsx (no separate compile step) so the cross-package ../../lib
# imports resolve at runtime exactly as they do in local dev/tests.

FROM node:20-slim

WORKDIR /app

# Install only what the worker needs: root deps (for the shared lib/ modules)
# plus the worker's own deps (ws, supabase-js, tsx). Copy manifests first for
# layer caching.
COPY package.json package-lock.json* ./
COPY worker/package.json ./worker/package.json
RUN npm ci --omit=dev || npm install --omit=dev
RUN cd worker && (npm install --omit=dev || true)

# Copy the source the worker actually imports.
COPY tsconfig.json ./tsconfig.json
COPY lib ./lib
COPY worker ./worker

# Run the worker. STREAM_WORKER_ENABLED must be "true" for it to connect;
# default OFF means the process boots, logs, and idles (safe no-op).
ENV NODE_ENV=production
CMD ["npx", "tsx", "worker/src/index.ts"]
