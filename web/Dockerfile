# =============================================================================
# Dev Gateway: administration panel
# =============================================================================
# One image, three stages. The runtime stage carries the built server, the
# built UI and the production dependencies only: no compiler, no source, no
# Docker CLI, and no access to the Docker socket. The panel reaches Docker
# exclusively through its own socket proxy over an internal network.
# =============================================================================

FROM node:24.20.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build -------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

# --- development -------------------------------------------------------------
# Used by compose.web-dev.yaml, which bind-mounts the source over /app and
# runs either the API with `node --watch` or Vite with HMR.
FROM deps AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY . .
# The container runs as an unprivileged user, and Vite writes a temporary
# config next to vite.config.ts and a cache under node_modules.
RUN chown -R node:node /app
USER node
EXPOSE 8081 5173
CMD ["node", "--watch", "src/server/index.ts"]

# --- runtime -----------------------------------------------------------------
FROM node:24.20.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8081/api/health || exit 1

CMD ["node", "dist/server/index.js"]
