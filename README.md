# OInurturning

OI 题材学员养成网页游戏。规划见 `docs/GAME-DESIGN.md`。

## 本地开发
1. `cp .env.example .env`（改掉 JWT_SECRET 与数据库口令）
2. `pnpm install`
3. `pnpm db:up && pnpm db:migrate`
4. `pnpm dev` → 打开 http://localhost:5173

## 测试
`pnpm test`（需要第 3 步的开发库在跑；测试库 `oinur_test` 自动建表）

## 生产部署
```bash
cd deploy && cp ../.env.example .env   # 补齐 MYSQL_PASSWORD/JWT_SECRET
docker compose up -d --build           # nginx :80 / api :3000(内部) / mysql 内部
```
备份：`deploy/backup.sh`（crontab 每日 mysqldump，见 TECH-DESIGN §10.3）。
