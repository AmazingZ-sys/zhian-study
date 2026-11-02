FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/utils/package.json ./packages/utils/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @zhian/api... install --frozen-lockfile --store-dir /pnpm/store
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @zhian/api... install --offline --frozen-lockfile --store-dir /pnpm/store && pnpm --filter @zhian/api build && pnpm --filter @zhian/api deploy --prod --offline --store-dir /pnpm/store /runtime

FROM node:22-alpine AS runtime
ARG VERSION=local
ARG COMMIT=unknown
ARG BUILD_DATE
LABEL org.opencontainers.image.title="zhian-study-api" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$COMMIT \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.source="https://github.com/AmazingZ-sys/zhian-study"
ENV NODE_ENV=production PORT=3000 RELEASE_VERSION=$VERSION
WORKDIR /app
COPY --from=build --chown=node:node /runtime ./
COPY --from=build --chown=node:node /workspace/apps/api/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/api/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
