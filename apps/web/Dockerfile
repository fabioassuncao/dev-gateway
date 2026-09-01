# =============================================================================
# Dev Gateway: administration panel
# =============================================================================
# Build context is the repository root so npm workspaces can install from the
# single lockfile. The runtime stage carries the built server, the built UI
# and the production dependencies only: no compiler, no source, no Docker CLI,
# and no access to the Docker socket. The panel reaches Docker exclusively
# through its own socket proxy over an internal network.
# =============================================================================

FROM node:24.20.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
# Install the whole workspace graph. Filtering with --workspace drops optional
# native bindings (Vite/rolldown) that the Alpine build needs.
RUN npm ci

# --- build -------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY apps/web/tsconfig.json apps/web/tsconfig.server.json apps/web/vite.config.ts ./apps/web/
COPY apps/web/src ./apps/web/src
# Both configs: the package builds through tsconfig.build.json, which extends
# tsconfig.json to drop the tests from the published output.
COPY packages/core/tsconfig.json packages/core/tsconfig.build.json ./packages/core/
COPY packages/core/src ./packages/core/src
RUN npm run build --workspace=@dev-gateway/core && npm run build --workspace=dev-gateway-web

# --- development -------------------------------------------------------------
# Used by docker/compose/features/web-dev.yaml, which bind-mounts the source over
# /app/apps/web and runs either the API with `node --watch` or Vite with HMR.
FROM deps AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY apps/web ./apps/web
# The workspace symlink npm ci created points at packages/core, so the shared
# package's source has to be here too: this stage never builds it, and the
# `development` export condition resolves it as TypeScript.
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/core/src ./packages/core/src
WORKDIR /app/apps/web
# The container runs as an unprivileged user, and Vite writes a temporary
# config next to vite.config.ts and a cache under node_modules.
RUN chown -R node:node /app
USER node
EXPOSE 8081 5173
# Through the package script, so `--conditions=development` is declared once.
# Dropping it resolves @dev-gateway/core to a dist/ this stage does not build.
CMD ["npm", "run", "dev"]

# --- runtime -----------------------------------------------------------------
FROM node:24.20.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
RUN npm ci --workspace=dev-gateway-web --omit=dev && npm cache clean --force
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY apps/web/migrations ./apps/web/migrations

WORKDIR /app/apps/web
USER node
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8081/api/health || exit 1

CMD ["node", "dist/server/index.js"]
