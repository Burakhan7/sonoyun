# Build from the repository root: docker build -f apps/realtime/Dockerfile .
FROM node:22.19-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/realtime/package.json apps/realtime/
COPY apps/realtime/prisma apps/realtime/prisma
COPY packages/shared/package.json packages/shared/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter "realtime..."
COPY packages/shared packages/shared
COPY apps/realtime apps/realtime
RUN pnpm --filter shared build && pnpm --filter realtime build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter "realtime..."
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/realtime/dist apps/realtime/dist
COPY apps/realtime/badwords.tr.txt apps/realtime/
USER node
WORKDIR /app/apps/realtime
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
