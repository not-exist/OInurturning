# OInurturning

OInurturning 是一款以信息学竞赛（OI）为题材的网页养成与模拟经营游戏。玩家扮演一所 OI 训练营的教练，招募学员、规划培养路线、经营学院资源，并带领队伍在各类赛事中取得荣誉。

灵感来自 OI 选手的成长路径：从入门的 CSP-J/S，到 NOIP、省选、NOI、IOI，每一阶段都需要不同的训练策略与团队协作。游戏将算法能力、思维与代码实现抽象为可成长的数值系统，配合随机事件、剧情赛与玩家锦标赛，呈现一个轻挂机、重策略的长期养成体验。

> 在线体验、截图与详细玩法以仓库 `docs/` 为准，本 README 仅作项目介绍与开发指引。

---

## 核心玩法

- **学员养成**：六维能力（数据结构、DP、数学、图论、贪心、字符串）+ 代码/思维/出题能力 + 天赋、心态、专注、精力等多维度成长。训练收益递减，突破依赖天赋与道具。
- **学院经营**：招募池定期刷新、声誉影响报酬与招募质量、讲课变现是主要收入来源。钱、声誉、体力的收支需要长期规划。
- **历练系统**：40+ 随机事件，分为对决/奇遇/试炼/机缘/麻烦/人情六类。每次派出 3 人小队，不同体力投入对应不同稀有度权重。
- **比赛模拟**：排名制模拟赛（剧情模式）与出题对决（历练遭遇战、PVP）两套确定性引擎。纯函数实现，同 seed 必复现，支持战报回放与审计。
- **剧情模式**：8 章（CSP-J → IOI），每章多关，首通奖励、NG+ 难度递增、里程碑道具。
- **PVP 锦标赛**：管理员发布赛事，玩家锁定阵容报名，服务端自动推进淘汰赛，奖励包含 PVP 独占的 tag 获取卡与进阶石。
- **题库与出题**：学员出题生成预制题，可用于专项训练提效、或带入对决替换临场生成题。
- **道具与天赋**：六档全局稀有度（灰 < 黄 < 绿 < 蓝 < 紫 < 彩），天赋家族树、进阶石升阶、洗练等长期追求。

---

## 技术栈

- **Monorepo**：pnpm workspace，`apps/*` 与 `packages/*`
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query + Zustand + React Router
- **后端**：Node.js 22+ + TypeScript + Express + Prisma + MySQL/MariaDB + Pino
- **共享**：`@oinur/shared` 统一前后端类型、Zod 校验与 API DTO
- **测试**：Vitest（单元/集成）+ Supertest + Playwright（E2E）
- **部署**：Docker Compose（mysql + api + nginx 静态托管前端）

设计原则见 `docs/TECH-DESIGN.md`：服务端权威结算、即时模拟 + 战报回放、读时惰性结算（体力/精力/被动收入）、配置即数据、确定性可复现模拟。

---

## 项目结构

```
OInurturning/
├── apps/
│   ├── api/                # 后端 API：Express + Prisma + 引擎
│   │   ├── prisma/         # schema 与 migrations
│   │   ├── src/
│   │   │   ├── config/     # env 与配置导入管线
│   │   │   ├── lib/        # prisma、logger、jwt、rng 等
│   │   │   ├── middlewares/
│   │   │   └── modules/    # 按领域划分：auth、students、academy、contest、pvp 等
│   │   └── tests/          # Vitest 单测/集成测试
│   └── web/                # 前端 SPA：Vite + React
│       └── src/
│           ├── app/        # 路由与布局
│           ├── features/   # 领域页面
│           ├── components/ # 通用 UI
│           └── lib/        # api client、query hooks、store
├── packages/
│   └── shared/             # 共享类型与 Zod schema
├── docs/
│   ├── GAME-DESIGN.md      # 游戏设计总纲（权威玩法规格）
│   ├── TECH-DESIGN.md      # 技术架构与实现约定
│   ├── OPERATIONS.md       # 部署、备份、运维手册
│   ├── systems/            # 分系统细则（学生、比赛、经济等）
│   └── data/               # 运行时配置源（yaml）：天赋、道具、题目、事件、关卡、经济
├── deploy/                 # 生产 Docker 与 Nginx 配置、备份脚本
├── tests/e2e/              # Playwright 浏览器级 E2E
├── scripts/                # 本地开发辅助脚本（bootstrap、seed、经济模拟等）
└── package.json            # 根脚本编排
```

---

## 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 10
- Docker（用于 MySQL）或本地 MySQL 8.4 / MariaDB

### 本地开发（常规网络）

```bash
cp .env.example .env          # 务必修改 JWT_SECRET、数据库口令
pnpm install
pnpm db:up                    # docker compose 起 MySQL，就绪后自动 prisma migrate deploy
pnpm dev                      # 前端 http://localhost:5173，后端 http://localhost:3000
```

可选：`pnpm -C apps/api seed` 灌入演示数据。

### 受限网络 / 无 Docker 环境

当无法访问 `binaries.prisma.sh` 且没有 Docker 时，仓库提供离线自举脚本：

```bash
pnpm install
node scripts/dev-bootstrap.mjs   # 自动：占位引擎 + queryCompiler 模式 + 本地 MySQL 二进制 + 建库
pnpm test
```

原理：Prisma 7 起客户端默认即 Rust-free（queryCompiler/WASM），运行时统一走 `@prisma/adapter-mariadb` driver adapter，不再需要 query engine 二进制；`prisma generate` 若因 CDN 不可达失败，bootstrap 会布置占位引擎绕过。数据库侧从 npm 拉取 MySQL 5.7 社区二进制在本地启动。生产与常规开发仍使用 compose 的 MySQL 8.4，迁移 SQL 兼容。

> Prisma 7 说明：数据库连接串不再写在 `apps/api/prisma/schema.prisma` 的 `datasource` 块里，而由 `apps/api/prisma.config.ts` 提供（CLI 侧），运行时则由 `PrismaClient({ adapter })` 直接持有。

---

## 开发指南

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 并行启动 api（tsx watch）与 web（vite dev，代理 /api） |
| `pnpm build` | 全仓构建（api tsup + web vite） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm secret` | 生成强随机 JWT_SECRET（48 字节 base64） |
| `pnpm admin:set` | 设置管理员账号（需 .env） |
| `pnpm sim:economy` | 经济收支模拟（读 economy.yaml） |
| `pnpm bal:regress` | 数值平衡回归检查 |

环境变量清单、限流与日志配置见 `.env.example` 与 `docs/OPERATIONS.md`。

---

## 测试

### 单元与集成测试（Vitest）

```bash
# 全量（排除 e2e 旅程）
pnpm -C apps/api test

# 仅单元（纯函数引擎、配置校验等，无需数据库，并行执行）
pnpm -C apps/api test:unit

# 仅集成（需 MySQL，串行执行，共享测试库 oinur_test）
pnpm -C apps/api test:integration

# 监听模式
pnpm -C apps/api test:watch

# 覆盖率
pnpm -C apps/api test:coverage

# 全链路 API 旅程（真配置 docs/data，需数据库，跑在 e2e Action）
pnpm -C apps/api test:e2e
```

测试设计：

- `global-setup.ts` 重建测试库并顺序应用全部迁移，支持 `VITEST_REUSE_DB=1` 跳过重建以加速本地迭代。
- `helpers.ts` 提供统一信封解包、快速用户重置（FK 关闭 + 事务批量删除）、单例 App 实例。
- 集成测试串行化（`fileParallelism: false` + `singleFork: true`），避免共享库污染；单元测试并行化以提升速度。
- 根 `pnpm test` 等价于 `pnpm -r test`，会执行 api、web、shared 的各自 test 脚本。

### E2E 测试（Playwright）

浏览器级端到端位于 `tests/e2e/`，共用 `oinur_e2e` 库，串行执行。

```bash
pnpm db:up
mysql -h 127.0.0.1 -uoinur -poinur -e "CREATE DATABASE IF NOT EXISTS oinur_e2e;"
DATABASE_URL='mysql://oinur:oinur@127.0.0.1:3306/oinur_e2e' pnpm -C apps/api migrate
pnpm exec playwright install chromium
pnpm e2e
```

更多说明见 `tests/e2e/README.md`。

---

## 生产部署

```bash
cd deploy
cp ../.env.example .env   # 补齐 MYSQL_PASSWORD、JWT_SECRET 等生产配置
docker compose up -d --build
```

- 构建 API 镜像时生成 Prisma Client；`docker compose up --build` 在 MySQL 健康后由 entrypoint 自动执行 `prisma migrate deploy`（幂等）。
- Nginx 负责静态托管前端与 `/api` 反代，安全响应头与 SPA fallback 已配置。
- 备份脚本：`deploy/backup.sh`（mysqldump + 滚动清理，凭据从容器环境读取）。
- 完整上线检查、备份恢复、日志与限流配置见 `docs/OPERATIONS.md`。

---

## 配置即数据

`docs/data/*.yaml` 同时是策划文档与运行时数据源：

- `talents.yaml` / `items.yaml` / `problems.yaml` / `events.yaml` / `stages.yaml` / `economy.yaml`
- API 启动时经 Zod 严格校验并导入 MySQL 配置表，内存缓存为只读。
- 改数值 = 改 yaml + 重启，无需发版。管理员可通过 `POST /api/admin/config/reload` 热重载。

---

## 文档

- `docs/GAME-DESIGN.md`：玩法总纲、资源体系、成长曲线、比赛与历练规则、剧情与 PVP 设计。
- `docs/TECH-DESIGN.md`：架构、数据库设计、API 约定、惰性结算、模拟引擎、安全与部署。
- `docs/OPERATIONS.md`：部署、备份、恢复、监控与上线检查。
- `docs/systems/`：分系统细则（学生、比赛、经济、学院等）。
- `docs/data/`：数值配置表（权威数据源）。

---

## 许可

本项目采用 **GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）**。

完整许可证文本见根目录 [`LICENSE`](LICENSE)。若你在网络上部署修改后的版本，需按 AGPL-3.0 第 13 条提供对应源码。

Copyright (C) 2026 OInurturning contributors
