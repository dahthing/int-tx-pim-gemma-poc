# syntax=docker/dockerfile:1.9
#
# Build from the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t pim-web .
#
# Static Angular build served by unprivileged nginx on 8080. `/api/` is proxied
# to API_UPSTREAM (default http://api:3100). No secrets: the SPA only carries
# public URLs from src/environments/environment.prod.ts.

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1-alpine

# --- pruner: only web + its workspace deps (shared-types) -----------------------
FROM ${NODE_IMAGE} AS pruner
WORKDIR /usr/src/app
ARG TURBO_VERSION=2.11.5
# Optional corporate/sandbox proxy CA: --secret id=extra_ca,src=/path/ca.pem (never stored in a layer).
RUN --mount=type=secret,id=extra_ca,target=/tmp/extra-ca.pem,required=false \
    if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    npm install --global --no-fund --no-audit turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune web --docker

# --- build ----------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV CI=true \
    PNPM_HOME=/pnpm \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /usr/src/app
RUN corepack enable

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
# Angular inlines Google Fonts at build time, so this step needs outbound HTTPS (fonts.googleapis.com).
# --env-mode=loose lets NODE_EXTRA_CA_CERTS (optional proxy CA) reach the ng build process.
RUN --mount=type=secret,id=extra_ca,target=/tmp/extra-ca.pem,required=false \
    if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    pnpm exec turbo run build --filter=web --env-mode=loose

# --- runtime: nginx, non-root (uid 101), listens on 8080 ------------------------
FROM ${NGINX_IMAGE} AS runtime

COPY --from=build --chown=nginx:nginx /usr/src/app/apps/web/dist/web/browser /usr/share/nginx/html
# envsubst of /etc/nginx/templates/*.template happens in the image entrypoint.
COPY --chown=nginx:nginx apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Reachable address of apps/api for the same-origin /api/ proxy.
ENV API_UPSTREAM=http://api:3100

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
