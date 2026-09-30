#!/bin/sh
# API 容器入口：先对 MySQL 执行 prisma migrate deploy（幂等），再启动进程。
# MIGRATE_ONLY=1 时迁移完成后直接退出，供 compose 一次性 migrate 服务复用同一迁移实现。
# compose 保证本脚本只在 mysql healthy 之后运行。
set -e

cd /app/apps/api

if [ -x ./node_modules/.bin/prisma ]; then
  PRISMA=./node_modules/.bin/prisma
elif [ -x /app/node_modules/.bin/prisma ]; then
  PRISMA=/app/node_modules/.bin/prisma
else
  echo "[entrypoint] prisma CLI 未找到，无法 migrate deploy" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL 未设置，无法 migrate deploy" >&2
  exit 1
fi

echo "[entrypoint] prisma migrate deploy"
"$PRISMA" migrate deploy

# 只跑迁移不启动服务（compose migrate 服务置 MIGRATE_ONLY=1）
if [ "${MIGRATE_ONLY:-0}" = "1" ]; then
  echo "[entrypoint] 迁移完成，MIGRATE_ONLY=1 退出"
  exit 0
fi

echo "[entrypoint] migrate 完成，启动 API"

exec node dist/index.js
