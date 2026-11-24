# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:22.19-slim AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter "web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
# Public values are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_REALTIME_URL
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN=
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_REALTIME_URL" \
  && pnpm --filter shared build \
  && pnpm --filter web exec next build --no-lint

FROM node:22.19-slim AS runtime
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3100 \
  HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/web/server.js"]
