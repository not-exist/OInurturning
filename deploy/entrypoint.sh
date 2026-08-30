#!/bin/sh
set -e
cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
exec node dist/index.js
