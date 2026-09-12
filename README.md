# OInurturning

OInurturning 是一款以信息学竞赛（OI）为题材的网页养成与模拟经营游戏。玩家扮演教练，招募并培养学员，安排训练和历练，参加剧情赛与玩家锦标赛，同时经营学院、制作题目并获取资源。

项目目前已具备从账号、学员、背包、训练，到剧情、历练、讲课、题库、PVP 和管理员工具的主要玩法闭环；经济数值与部署运维能力也已完成基础校准。正式的玩法、系统规则和数据配置以 `docs/` 下文档为准，不再维护阶段性 AI 规划或会话记录。

## 项目结构

- `apps/api`：Node.js、TypeScript、Prisma 后端 API
- `apps/web`：Vite、React、Tailwind 前端
- `packages/shared`：前后端共享类型与校验
- `docs/GAME-DESIGN.md`：完整游戏设计与规则
- `docs/TECH-DESIGN.md`：技术架构与实现约定
- `docs/systems/`：玩法系统细则
- `docs/data/`：事件、关卡、道具、天赋和经济配置
- `docs/OPERATIONS.md`：部署、备份、恢复和上线检查
- `deploy/`：Docker Compose、镜像与 Nginx 配置

## 技术栈

pnpm workspace、TypeScript、React、Vite、Node.js、Prisma、MySQL/MariaDB、Vitest、Playwright 和 Docker Compose。

## 本地开发

```bash
cp .env.example .env       # 至少修改 JWT_SECRET 和数据库口令
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev                    # 前端通常在 http://localhost:5173
```

需要演示数据时可运行 `pnpm seed`。数据库相关命令和环境变量说明见各包的 `package.json` 及 `docs/OPERATIONS.md`。

## 检查与测试

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

经济模拟和数值回归可分别使用 `pnpm sim:economy` 与 `pnpm bal:regress`。端到端测试位于 `tests/e2e/`，运行前请准备对应的开发数据库和浏览器环境。

## 生产部署

```bash
cd deploy
cp ../.env.example .env       # 补齐 MYSQL_PASSWORD、JWT_SECRET 等生产配置
docker compose up -d --build
```

部署前请阅读 `docs/OPERATIONS.md`，尤其是密钥、管理员初始化、备份恢复、日志和限流配置。备份脚本为 `deploy/backup.sh`。

## 许可

本项目采用 **GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）**。完整许可证文本见根目录 [`LICENSE`](LICENSE)，版权与再发布要求以 GNU AGPLv3 正文为准。
