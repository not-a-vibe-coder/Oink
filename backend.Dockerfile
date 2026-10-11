# Oink API for Render (Docker runtime). The backend imports a few pure, dependency-free shared
# modules from src/lib/{bell,flow}; only those are copied from the frontend tree.
FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY backend/package.json backend/bun.lock backend/
RUN cd backend && bun install --frozen-lockfile --production
COPY backend/ backend/
COPY src/lib/bell/ src/lib/bell/
COPY src/lib/flow/ src/lib/flow/
WORKDIR /app/backend
ENV NODE_ENV=production
USER bun
EXPOSE 3001
# Migrations run at boot (forward-only, idempotent), then the API listens on $PORT.
CMD ["bun", "run", "src/index.ts"]
