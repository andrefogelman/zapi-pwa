# syntax=docker/dockerfile:1
# Self-hosted build of the zapi-pwa Next app (bun workspace monorepo) for king.
# Build context = repo root (needs root package.json + bun.lock + packages/*).

FROM oven/bun:1 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun --filter pwa build

# Next "standalone" output bundles a minimal node server + traced deps,
# preserving the monorepo layout (server entry at packages/pwa/server.js).
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3401
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/packages/pwa/.next/standalone ./
COPY --from=builder /app/packages/pwa/.next/static ./packages/pwa/.next/static
COPY --from=builder /app/packages/pwa/public ./packages/pwa/public
EXPOSE 3401
CMD ["node", "packages/pwa/server.js"]
