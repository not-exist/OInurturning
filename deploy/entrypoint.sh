#!/bin/sh
# API 容器入口：先对 MySQL 执行 prisma migrate deploy（幂等），再启动进程。
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
echo "[entrypoint] migrate 完成，启动 API"

exec node dist/index.js
