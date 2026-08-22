# syntax=docker/dockerfile:1

# mem-port container image.
#
# Three stages so the runtime layer carries neither the toolchain nor the dev
# dependencies: build compiles, model fetches the embedding weights, runtime
# assembles what is actually needed to serve.

# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.ui.json tsup.config.ts ./
COPY scripts ./scripts
COPY src ./src
# Runs build:ui first via prebuild, then tsup -> dist/cli.js
RUN npm run build

# ---------------------------------------------------------------------------
# Separate stage so the weights are cached independently of the source: editing
# a tool file must not re-download the model.
FROM node:22-slim AS model
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY scripts/prefetch-model.mjs ./scripts/
ENV MEM_PORT_MODEL_CACHE_DIR=/app/models
RUN node scripts/prefetch-model.mjs

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=model /app/models ./models

# Weights are already here; nothing is fetched at runtime.
ENV MEM_PORT_MODEL_CACHE_DIR=/app/models

# Bind all interfaces: in a container the isolation boundary is the container,
# not the loopback device, and the platform decides what may reach the port.
# This is safe ONLY behind an auth layer or a private network — mem-port has no
# authentication of its own, and library-id selects a tenant rather than
# proving a right to it.
ENV MEM_PORT_HOST=0.0.0.0

# Overridden by the platform's injected PORT where there is one.
ENV MEM_PORT_PORT=8787
EXPOSE 8787

# Writable only where a volume is mounted; with a hosted database this holds
# nothing but scratch, which is why hosted is required for ephemeral platforms.
ENV MEM_PORT_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app

USER node

# The daemon exposes no health route of its own: it answers POST /mcp and 404s
# everything else. A 404 still proves the process is up and serving, which is
# all a liveness check needs.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.MEM_PORT_PORT||8787)+'/').then(r=>process.exit(r.status===404||r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
