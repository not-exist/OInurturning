#!/bin/sh
set -e
npx -y prisma@6.10.0 migrate deploy
exec node dist/index.js
