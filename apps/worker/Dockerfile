# syntax=docker/dockerfile:1.9
#
# Build from the REPO ROOT (the context needs the whole workspace for `turbo prune`):
#   docker build -f apps/worker/Dockerfile -t pim-worker .
#
# Stages: pruner (turbo prune: only worker's workspace deps) -> builder (install,
# prisma generate, compile, pnpm deploy --prod) -> runtime (prod deps only, non-root).
# No secrets are baked in: configuration comes from env vars at `docker run`.

ARG NODE_IMAGE=node:22-alpine

# --- pruner: reduce the monorepo to worker + its workspace dependencies -----------
FROM ${NODE_IMAGE} AS pruner
WORKDIR /usr/src/app
# Keep in sync with the turbo version in pnpm-lock.yaml / root package.json.
ARG TURBO_VERSION=2.11.5
# Optional corporate/sandbox proxy CA: --secret id=extra_ca,src=/path/ca.pem (never stored in a layer).
RUN --mount=type=secret,id=extra_ca,target=/tmp/extra-ca.pem,required=false \
    if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    npm install --global --no-fund --no-audit turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune worker --docker

# --- builder: install, generate Prisma client, compile --------------------------
FROM ${NODE_IMAGE} AS builder
ENV CI=true \
    PNPM_HOME=/pnpm \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /usr/src/app
# Corepack picks pnpm 10.33.0 from the root package.json "packageManager" field.
RUN corepack enable

# Manifests + pruned lockfile first: this layer only changes with dependencies.
COPY --from=pruner /usr/src/app/out/json/ .
COPY --from=pruner /usr/src/app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY patches ./patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=secret,id=extra_ca,target=/tmp/extra-ca.pem,required=false \
    if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    pnpm install --frozen-lockfile

COPY --from=pruner /usr/src/app/out/full/ .
# Several tsconfigs extend ../typescript-config/*.json by relative path without declaring the
# package as a dependency, so `turbo prune` leaves it out. It is JSON only.
COPY packages/typescript-config ./packages/typescript-config
# turbo's "build" task depends on db:generate (Prisma client) and ^build.
RUN pnpm exec turbo run build --filter=worker

# Self-contained production tree built from the lockfile (no registry re-resolve): prod deps + built workspace packages in /prod/worker.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    npm_config_inject_workspace_packages=true \
    pnpm --filter=worker deploy --prod /prod/worker

# --- runtime: production dependencies only, non-root ----------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3400
WORKDIR /usr/src/app

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nestjs

COPY --from=builder --chown=nestjs:nodejs /prod/worker/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /usr/src/app/apps/worker/dist ./dist

USER nestjs
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health/live" || exit 1

CMD ["node", "dist/main.js"]
