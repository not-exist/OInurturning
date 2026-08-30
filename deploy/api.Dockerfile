# ---- stage 1: 构建 ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY docs/data docs/data
RUN pnpm -C apps/api generate && pnpm -C apps/api build

# ---- stage 2: 运行 ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production CONFIG_DIR=/app/config
# 镜像 pnpm workspace 布局：tsup 默认外置 dependencies，运行时需要
# apps/api/node_modules（相对符号链接 → 根 node_modules/.pnpm）解析链完整
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/docs/data ./config
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
