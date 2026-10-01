# syntax=docker/dockerfile:1

# GigMap API image. Build from the repo root:
#
#   docker build -t gigmap-api .
#
# Runs the API by default. Apply migrations as a release step with the same
# image before rolling out new containers:
#
#   docker run --rm -e DATABASE_URL -e DIRECT_URL gigmap-api \
#     node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
#
# See docs/deployment.md.

FROM node:22-bookworm-slim AS base
# Prisma picks its query engine by the OpenSSL it finds at generate time and
# needs the same library at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# --- Build -----------------------------------------------------------------
FROM base AS build

# Manifests first so the dependency layer is cached across source changes.
# The Prisma schema is needed too: `postinstall` generates the client.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @gigmap/shared build && pnpm --filter @gigmap/api build

# Drop dev dependencies. Scripts are skipped so the Prisma client generated
# above is kept as-is. pnpm purges and relinks node_modules when the
# dependency set changes; without a TTY it would otherwise refuse to.
RUN CI=true pnpm install --frozen-lockfile --prod --ignore-scripts \
  --config.confirmModulesPurge=false

# --- Runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3333

COPY --from=build --chown=node:node /repo/node_modules node_modules
COPY --from=build --chown=node:node /repo/packages/shared/package.json packages/shared/
COPY --from=build --chown=node:node /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json apps/api/
COPY --from=build --chown=node:node /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist

USER node
EXPOSE 3333
# Liveness only: a database outage must not get containers restarted.
# Orchestrators should route on GET /health/ready (see docs/deployment.md).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health/live').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
