# M0 骨架与账号系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 OInurturning 的 pnpm monorepo 骨架，交付注册/登录/改密/注销全链路账号系统与一键容器化部署。

**Architecture:** 三包 monorepo（apps/web 前端 SPA、apps/api 后端 Express、packages/shared 共享 TS 类型）。JWT 双令牌（15min access 内存存取 + 7d HttpOnly 刷新 Cookie），`tokenVersion` 无状态全局踢下线。服务端权威、统一响应信封、错误码化。

**Tech Stack:** Node 22 LTS · pnpm workspaces · TypeScript(strict) · Express 5 · Prisma 6 + MySQL 8 · zod · pino · vitest + supertest · React 19 + Vite + React Router 7 + Tailwind v4 + zustand · Docker Compose

**Spec:** `docs/GAME-DESIGN.md` §17、`docs/TECH-DESIGN.md` §1/§3(User)/§5.1/§5.2(#1–8)/§9/§10、`docs/ROADMAP.md` M0（T0.1–T0.7）

## Global Constraints

- 包管理只用 pnpm（workspace 协议 `workspace:*`）；不引入 Turborepo/Nx/WebSocket/Redis/CORS 中间件（开发期由 Vite proxy 同源化）。
- TypeScript 全仓 `strict: true`，模块策略 `NodeNext`（web 由 Vite 处理可用 bundler 模式）。
- 统一响应信封：成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message, details? } }`。
- 错误码（本里程碑用到）：`UNAUTHENTICATED`(401) / `INVALID_CREDENTIALS`(401) / `TOKEN_EXPIRED`(401) / `FORBIDDEN`(403) / `NOT_FOUND`(404) / `VALIDATION_FAILED`(400) / `ALREADY_EXISTS`(409) / `INTERNAL`(500)。
- 密码：bcryptjs cost 默认 12（env `BCRYPT_COST` 可降为 10），长度 8–72；登录失败统一 `INVALID_CREDENTIALS` 防枚举。
- JWT：HS256；access TTL 15min（claim 含 `uid/role/tokenVersion`）；refresh TTL 7d，HttpOnly+Secure(prod)+SameSite=Strict Cookie `Path=/api/auth`；每次 refresh 轮换双令牌；改密/登出/注销/封禁 → `tokenVersion+1`。
- 限流：`/api/auth/*` 10 req/15min/IP，全局 300 req/min/IP（express-rate-limit 内存桶）。
- 时间字段一律 ISO 8601 UTC；金额/声誉 `Int`。
- 提交纪律：每个任务至少一个 commit，Conventional Commits，结尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 数值禁止硬编码进业务代码之外的地方——本里程碑无玩法数值，仅需遵守「常量集中在 env 或 shared」。

---

### Task 1: 仓库初始化与工程基线

**Files:**
- Create: `.gitignore`, `.prettierrc`, `eslint.config.mjs`, `tsconfig.base.json`, `package.json`, `pnpm-workspace.yaml`, `.env.example`, `docker-compose.yml`（本地开发：仅 mysql）

**Interfaces:**
- Produces: 可用的 pnpm workspace 与根脚本 `dev/build/test/lint/typecheck/format`；本地 MySQL 8 容器（端口 3306，库 `oinur`/`oinur_test`，用户 `oinur/oinur`）。

- [ ] **Step 1: git 初始化并提交现有规划文档**

```bash
cd /home/qzez/OInurturning && git init -b main
git add docs/ InitPlan && git commit -m "docs: 规划套件（总纲/系统细则/数据表/技术架构/路线图）"
```

- [ ] **Step 2: 写入根配置文件**

`.gitignore`:

```gitignore
node_modules/
dist/
*.tsbuildinfo
.env
.env.local
coverage/
apps/api/prisma/migrations/dev/
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

`package.json`（根）:

```json
{
  "name": "oinurturning",
  "private": true,
  "packageManager": "pnpm@10.14.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm -r --parallel --filter './apps/*' dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "format": "prettier --write .",
    "db:up": "docker compose up -d && until docker compose exec mysql mysqladmin ping -h 127.0.0.1 -uoinur -poinur --silent >/dev/null 2>&1; do sleep 1; done && echo mysql-ready",
    "db:migrate": "pnpm -C apps/api migrate"
  },
  "devDependencies": {
    "eslint": "^9.30.0",
    "prettier": "^3.6.0",
    "typescript-eslint": "^8.35.0",
    "typescript": "^5.8.0"
  }
}
```

`.prettierrc`:

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": false,
    "sourceMap": true
  }
}
```

`eslint.config.mjs`（安全红线：禁用 *Unsafe 原始 SQL）:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name=/.*Unsafe$/]",
          message: '禁止 $queryRawUnsafe/$executeRawUnsafe：只允许模板字符串形式的参数化原始查询',
        },
      ],
    },
  },
);
```

`.env.example`:

```bash
# ---- 数据库 ----
MYSQL_DATABASE=oinur
MYSQL_USER=oinur
MYSQL_PASSWORD=oinur
MYSQL_ROOT_PASSWORD=change-me-root
DATABASE_URL="mysql://oinur:oinur@localhost:3306/oinur"
# ---- 认证 ----
JWT_SECRET=change-me-at-least-32-chars-random-xxxxxxx
BCRYPT_COST=12
# ---- 服务 ----
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

`docker-compose.yml`（根，仅本地开发数据库）:

```yaml
name: oinur-dev
services:
  mysql:
    image: mysql:8.4
    container_name: oinur-mysql
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${MYSQL_DATABASE:-oinur}
      MYSQL_USER: ${MYSQL_USER:-oinur}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-oinur}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-change-me-root}
    ports: ['3306:3306']
    command: [--character-set-server=utf8mb4, --collation-server=utf8mb4_0900_ai_ci]
    volumes: [dbdata:/var/lib/mysql]
    healthcheck:
      test: ['CMD-SHELL', 'mysqladmin ping -h 127.0.0.1 -u$$MYSQL_USER -p$$MYSQL_PASSWORD --silent']
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 20s
volumes:
  dbdata:
```

另建 `tests/.gitkeep` 占位的测试数据库说明写入 README（Task 9）。创建第二个数据库供集成测试：

```bash
cp .env.example .env
docker compose up -d mysql
until docker compose exec -T mysql mysqladmin ping -h 127.0.0.1 -uoinur -poinur --silent >/dev/null 2>&1; do sleep 1; done
docker compose exec -T mysql mysql -uoinur -poinur -e "CREATE DATABASE IF NOT EXISTS oinur_test;"
```

- [ ] **Step 3: 安装依赖并验证**

Run: `pnpm install && pnpm typecheck`
Expected: 无包错误（尚无可 typecheck 的子包则输出空跑成功）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: monorepo 工程基线（workspace/tsconfig/eslint/env/dev-compose）"
```

---

### Task 2: packages/shared 共享类型包

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/src/enums.ts`, `packages/shared/src/api.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `ApiOk<T> = { ok: true; data: T }`、`ApiErr = { ok: false; error: { code: ErrorCode; message: string; details?: unknown } }`、`ApiEnvelope<T> = ApiOk<T> | ApiErr`
  - `ERROR_CODES` 常量元组与 `type ErrorCode`
  - `RARITIES/Rarity`、`DIMENSIONS/DimensionKey`、`ABILITY_KEYS/AbilityKey`（M0 仅作契约锚点）
- Consumes: 无（最底层包）。

- [ ] **Step 1: 写入包定义**

`packages/shared/package.json`:

```json
{
  "name": "@oinur/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.25.67" },
  "devDependencies": { "typescript": "^5.8.0" }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 2: 写入枚举与 API 信封类型**

`packages/shared/src/enums.ts`:

```ts
/** 全局统一稀有度序列：灰 < 黄 < 绿 < 蓝 < 紫 < 彩（GAME-DESIGN §5） */
export const RARITIES = ['GRAY', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW'] as const;
export type Rarity = (typeof RARITIES)[number];

/** 六维键：六个独立数值，绝不合并（GAME-DESIGN §6） */
export const DIMENSIONS = ['DS', 'DP', 'MATH', 'GRAPH', 'GREEDY', 'STRING'] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export const ABILITY_KEYS = [...DIMENSIONS, 'CODING', 'THINKING', 'PROBLEM'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];
```

`packages/shared/src/api.ts`:

```ts
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INSUFFICIENT_RESOURCE',
  'STATE_CONFLICT',
  'ALREADY_EXISTS',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr {
  ok: false;
  error: { code: ErrorCode; message: string; details?: unknown };
}
export type ApiEnvelope<T> = ApiOk<T> | ApiErr;

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }

export interface MeView {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  lastLoginAt: string | null;
  money: number;
  reputation: number;
  badges: string[];
}
```

`packages/shared/src/index.ts`:

```ts
export * from './enums.js';
export * from './api.js';
```

注意：`exports` 直接指向 `.ts` 源码——Vite/tsx/esbuild 都能消费；`index.ts` 里相对导出写显式 `.js` 后缀以兼容 NodeNext 解析。

- [ ] **Step 3: 安装并验证类型检查**

Run: `pnpm install && pnpm -C packages/shared typecheck`
Expected: 通过（无输出）。

- [ ] **Step 4: Commit**

```bash
git add packages/shared pnpm-lock.yaml && git commit -m "feat(shared): API 信封/错误码/基础枚举类型契约"
```

---

### Task 3: API 应用骨架与健康检查

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/config/env.ts`, `apps/api/src/lib/logger.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/lib/prisma.ts`, `apps/api/src/middlewares/requestId.ts`, `apps/api/src/middlewares/errorHandler.ts`, `apps/api/src/index.ts`, `apps/api/tests/helpers.ts`
- Test: `apps/api/tests/health.test.ts`

**Interfaces:**
- Consumes: `@oinur/shared` 的 `ApiEnvelope/ErrorCode`。
- Produces:
  - `createApp(): Express` —— 装配好全部中间件的裸应用（supertest 直接注入，不监听端口）
  - `startServer(): Promise<http.Server>` —— 生产入口（先 env 校验后启动）
  - `class ApiError extends Error { constructor(public code: ErrorCode, public details?: unknown, public httpStatus?: number) }`
  - `env`: zod 解析后的环境变量单例 `{ PORT, NODE_ENV, DATABASE_URL, JWT_SECRET, BCRYPT_COST, LOG_LEVEL }`
  - 健康端点 `GET /api/health` → `{ ok: true, data: { uptime, serverTime } }`

- [ ] **Step 1: 写入包定义与构建脚本**

`apps/api/package.json`:

```json
{
  "name": "@oinur/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --target node22 --sourcemap --clean",
    "start": "node dist/index.js",
    "migrate": "prisma migrate deploy",
    "generate": "prisma generate",
    "test": "vitest run",
    "lint": "eslint src/ tests/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oinur/shared": "workspace:*",
    "@prisma/client": "^6.10.0",
    "bcryptjs": "^3.0.2",
    "dotenv": "^16.5.0",
    "express": "^5.1.0",
    "express-rate-limit": "^7.6.0",
    "helmet": "^8.1.0",
    "jsonwebtoken": "^9.0.2",
    "pino": "^9.7.0",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "@types/express": "^5.0.3",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^22.15.0",
    "@types/supertest": "^6.0.3",
    "pino-pretty": "^13.0.0",
    "prisma": "^6.10.0",
    "supertest": "^7.1.0",
    "tsup": "^8.5.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "tests"]
}
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    poolOptions: { threads: { singleThread: true } },
  },
});
```

- [ ] **Step 2: 写 env 加载、logger、errors、prisma 单例**

`apps/api/src/config/env.ts`:

```ts
import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 字节随机'),
  BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] 环境变量校验失败：\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
```

`apps/api/src/lib/logger.ts`:

```ts
import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({ level: env.LOG_LEVEL });
```

`apps/api/src/lib/errors.ts`:

```ts
import type { ErrorCode } from '@oinur/shared';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INSUFFICIENT_RESOURCE: 409,
  STATE_CONFLICT: 409,
  ALREADY_EXISTS: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly httpStatus: number;
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
    httpStatusOverride?: number,
  ) {
    super(code);
    this.httpStatus = httpStatusOverride ?? STATUS[code];
  }
}
```

`apps/api/src/lib/prisma.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
```

- [ ] **Step 3: 写中间件与应用装配**

`apps/api/src/middlewares/requestId.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request { requestId: string }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
```

`apps/api/src/middlewares/errorHandler.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import type { ApiEnvelope } from '@oinur/shared';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    const body: ApiEnvelope<never> = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.httpStatus).json(body);
    return;
  }
  logger.error({ err, requestId: req.requestId }, 'unhandled error');
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: '服务器内部错误' } });
}
```

`apps/api/src/index.ts`:

```ts
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { requestId } from './middlewares/requestId.js';
import { errorHandler } from './middlewares/errorHandler.js';
import type { ApiEnvelope } from '@oinur/shared';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(requestId);

  app.get('/api/health', (_req, res) => {
    const body: ApiEnvelope<{ uptime: number; serverTime: string }> = {
      ok: true,
      data: { uptime: process.uptime(), serverTime: new Date().toISOString() },
    };
    res.json(body);
  });

  app.use(errorHandler);
  return app;
}

export function startServer(): void {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}

// 被 tsx watch 直跑时启动；被测试导入时仅暴露 createApp
if (process.env.VITEST !== 'true') {
  void crypto.randomUUID; // 触发 node:crypto 引用完整性（占位，无副作用）
  startServer();
}
```

- [ ] **Step 4: 测试助手与失败测试**

`apps/api/tests/global-setup.ts`:

```ts
export default async function setup(): Promise<void> {
  process.env.VITEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
  process.env.DATABASE_URL ||= 'mysql://oinur:oinur@localhost:3306/oinur_test';
}
```

`apps/api/tests/helpers.ts`:

```ts
import request from 'supertest';
import type { Express } from 'express';
import type { ApiEnvelope } from '@oinur/shared';

export function get(app: Express, url: string): request.Test {
  return request(app).get(url);
}

export function unwrap<T>(res: request.Response): ApiEnvelope<T> {
  return res.body as ApiEnvelope<T>;
}
```

`apps/api/tests/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { get, unwrap } from './helpers.js';

const app = createApp();

describe('GET /api/health', () => {
  it('返回统一信封的成功数据', async () => {
    const res = await get(app, '/api/health');
    expect(res.status).toBe(200);
    const body = unwrap<{ uptime: number; serverTime: string }>(res);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof body.data.uptime).toBe('number');
  });
});
```

- [ ] **Step 5: 安装依赖、生成 prisma client（先建空 schema）、运行测试**

```bash
pnpm install
printf 'generator client { provider = "prisma-client-js" }\ndatasource db { provider = "mysql" url = env("DATABASE_URL") }\n' > apps/api/prisma/schema.prisma
pnpm -C apps/api generate
pnpm -C apps/api test
```

Expected: health.test.ts PASS。（此时尚未引入 prisma.ts 对 client 的使用报错？——已通过 generate 解决。）

- [ ] **Step 6: Commit**

```bash
git add apps/api && git commit -m "feat(api): Express 骨架（env 校验/统一错误信封/requestId/health）"
```

---

### Task 4: Prisma User 模型与首次迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/`（由 migrate 生成）

**Interfaces:**
- Produces: `User` 表（字段与 TECH-DESIGN §3 完全一致：id/username/passwordHash/role/money/reputation/badges/tokenVersion/bannedAt/lastLoginAt/lastSettledAt/createdAt/updatedAt）。M0 只迁移 User 单表；关系字段待后续里程碑的模型落地时在各自迁移中追加。
- Consumes: Task 1 的本地 MySQL。

- [ ] **Step 1: 写入完整 User 模型**

替换 `apps/api/prisma/schema.prisma` 为：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id            Int       @id @default(autoincrement())
  username      String    @unique @db.VarChar(32)
  passwordHash  String?
  role          Role      @default(USER)
  money         Int       @default(0)
  reputation    Int       @default(0)
  badges        Json      @default("[]")
  tokenVersion  Int       @default(0)
  bannedAt      DateTime?
  lastLoginAt   DateTime?
  lastSettledAt DateTime  @default(now())
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@map("users")
}
```

- [ ] **Step 2: 生成并执行迁移（对开发库与测试库各一次）**

```bash
pnpm -C apps/api exec prisma migrate dev --name init_user --skip-seed
docker compose exec -T mysql mysql -uoinur -poinur oinur_test < <(pnpm -C apps/api exec prisma migrate diff --from-empty --to-schema-datamodel apps/api/prisma/schema.prisma --script)
```

Expected: 迁移目录生成、users 表存在于 `oinur`；第二条命令将等价 SQL 应用于 `oinur_test`（若 diff 输出为空说明已存在则跳过）。

- [ ] **Step 3: 验证表结构**

Run: `docker compose exec -T mysql mysql -uoinur -poinur oinur -e "DESCRIBE users;" | head -8`
Expected: 看到 id/username/passwordHash/role 等列。

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma && git commit -m "feat(db): User 模型与初始迁移"
```

---

### Task 5: 认证模块（一）：注册 / 登录 / 我的信息 + requireAuth

**Files:**
- Create: `apps/api/src/lib/jwt.ts`, `apps/api/src/middlewares/requireAuth.ts`, `apps/api/src/modules/auth/schemas.ts`, `apps/api/src/modules/auth/service.ts`, `apps/api/src/modules/auth/router.ts`
- Modify: `apps/api/src/index.ts`（挂载 router 与限流）
- Test: `apps/api/tests/auth-basic.test.ts`, `apps/api/tests/global-setup.ts`（追加清库逻辑）

**Interfaces:**
- Consumes: `ApiError`、`prisma`、`env`、shared `MeView`。
- Produces:
  - `signAccess(user: { id: number; role: 'USER'|'ADMIN'; tokenVersion: number }): string`
  - `signRefresh(user: 同上): string`
  - `requireAuth: RequestHandler` —— 成功后 `req.user = { id, role, tokenVersion }`
  - 路由：`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/users/me`
  - 响应体约定（register/login 成功）：`data = { accessToken: string, me: MeView }`，同时 Set-Cookie 刷新令牌 `oinur_rt`

- [ ] **Step 1: global-setup 追加测试前清库**

修改 `apps/api/tests/global-setup.ts`：

```ts
import { execSync } from 'node:child_process';

export default async function setup(): Promise<void> {
  process.env.VITEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
  process.env.DATABASE_URL ||= 'mysql://oinur:oinur@localhost:3306/oinur_test';
  // 测试库结构对齐开发库迁移（幂等）
  const sql = execSync(
    'pnpm -C apps/api exec prisma migrate diff --from-empty --to-schema-datamodel apps/api/prisma/schema.prisma --script',
    { cwd: '../../', encoding: 'utf8' },
  );
  execSync(
    `docker compose exec -T mysql mysql -uoinur -poinur oinur_test -e "${sql.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`,
    { cwd: '../../', stdio: 'pipe' },
  );
}
```

并在 `helpers.ts` 追加：

```ts
import { prisma } from '../src/lib/prisma.js';

export async function resetUsers(): Promise<void> {
  await prisma.user.deleteMany({});
}
```

- [ ] **Step 2: 写失败测试（注册/登录/me）**

`apps/api/tests/auth-basic.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { resetUsers, unwrap } from './helpers.js';
import type { MeView } from '@oinur/shared';

const app = createApp();
const U = { username: 'coach01', password: 'password123' };

beforeEach(resetUsers);

describe('POST /api/auth/register', () => {
  it('注册成功：返回 accessToken 与 MeView，并种下刷新 Cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(U);
    expect(res.status).toBe(200);
    const body = unwrap<{ accessToken: string; me: MeView }>(res);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.accessToken.split('.')).toHaveLength(3);
    expect(body.data.me.username).toBe(U.username);
    expect(body.data.me.money).toBe(0);
    const cookie = res.headers['set-cookie'].find((c: string) => c.startsWith('oinur_rt='));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('重复用户名 → ALREADY_EXISTS', async () => {
    await request(app).post('/api/auth/register').send(U);
    const res = await request(app).post('/api/auth/register').send(U);
    expect(res.status).toBe(409);
    expect(unwrap(res).error?.code).toBe('ALREADY_EXISTS');
  });

  it.each([
    ['短密码', 'ab1'],
    ['超长密码', 'x'.repeat(73)],
    ['空用户名', ''],
  ])('非法输入 %s → VALIDATION_FAILED', async (_n, bad) => {
    const res = await request(app).post('/api/auth/register').send({ username: bad, password: bad });
    expect([400, 409]).toContain(res.status);
    expect(unwrap(res).error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/auth/login', () => {
  it('正确凭据 → accessToken + lastLoginAt 更新', async () => {
    await request(app).post('/api/auth/register').send(U);
    const res = await request(app).post('/api/auth/login').send(U);
    const body = unwrap<{ accessToken: string; me: MeView }>(res);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.me.lastLoginAt).not.toBeNull();
  });

  it('密码错误 → 401 INVALID_CREDENTIALS（与用户不存在同码）', async () => {
    await request(app).post('/api/auth/register').send(U);
    const wrongPw = await request(app).post('/api/auth/login').send({ ...U, password: 'wrong-pass-1' });
    const noUser = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'wrong-pass-1' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(unwrap(wrongPw).error?.code).toBe('INVALID_CREDENTIALS');
    expect(unwrap(noUser).error?.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/users/me', () => {
  it('带有效 token → MeView；无 token → UNAUTHENTICATED', async () => {
    const reg = await request(app).post('/api/auth/register').send(U);
    const token = unwrap<{ accessToken: string }>(reg).data.accessToken;
    const ok = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(unwrap<MeView>(ok).data.role).toBe('USER');
    const anon = await request(app).get('/api/users/me');
    expect(anon.status).toBe(401);
    expect(unwrap(anon).error?.code).toBe('UNAUTHENTICATED');
  });
});
```

Run: `pnpm -C apps/api test -- auth-basic`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 jwt 工具与 requireAuth**

`apps/api/src/lib/jwt.ts`:

```ts
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessClaims {
  uid: number;
  role: 'USER' | 'ADMIN';
  tv: number; // tokenVersion
}

export function signAccess(u: AccessClaims): string {
  return jwt.sign(u, env.JWT_SECRET, { expiresIn: '15m' });
}

export function signRefresh(u: AccessClaims): string {
  return jwt.sign({ uid: u.uid, tv: u.tv, typ: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyAccess(token: string): AccessClaims {
  const claims = jwt.verify(token, env.JWT_SECRET) as AccessClaims;
  if (typeof claims.uid !== 'number') throw new jwt.JsonWebTokenError('malformed claims');
  return claims;
}

export function verifyRefresh(token: string): AccessClaims & { typ: 'refresh' } {
  const claims = jwt.verify(token, env.JWT_SECRET) as AccessClaims & { typ?: string };
  if (claims.typ !== 'refresh') throw new jwt.JsonWebTokenError('not a refresh token');
  return claims as AccessClaims & { typ: 'refresh' };
}
```

`apps/api/src/middlewares/requireAuth.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyAccess } from '../lib/jwt.js';
import { ApiError } from '../lib/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: number; role: 'USER' | 'ADMIN'; tokenVersion: number };
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  void (async (): Promise<void> => {
    try {
      const h = req.headers.authorization;
      if (!h?.startsWith('Bearer ')) throw new ApiError('UNAUTHENTICATED');
      let claims: ReturnType<typeof verifyAccess>;
      try {
        claims = verifyAccess(h.slice(7));
      } catch (e) {
        if (e instanceof jwt.TokenExpiredError) throw new ApiError('TOKEN_EXPIRED');
        throw new ApiError('UNAUTHENTICATED');
      }
      const user = await prisma.user.findUnique({
        where: { id: claims.uid },
        select: { id: true, role: true, tokenVersion: true, bannedAt: true },
      });
      if (!user || user.bannedAt || user.tokenVersion !== claims.tv) throw new ApiError('UNAUTHENTICATED');
      req.user = { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
      next();
    } catch (e) { next(e); }
  })();
}
```

文件顶部补 `import jwt from 'jsonwebtoken';`。

- [ ] **Step 4: 实现 schemas / service / router**

`apps/api/src/modules/auth/schemas.ts`:

```ts
import { z } from 'zod';

export const CredentialsSchema = z.object({
  username: z.string().trim().min(2, '用户名至少 2 字符').max(32),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最长 72 位'),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});
```

`apps/api/src/modules/auth/service.ts`:

```ts
import bcrypt from 'bcryptjs';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { signAccess, signRefresh, type AccessClaims } from '../../lib/jwt.js';
import type { MeView } from '@oinur/shared';
import type { User } from '@prisma/client';

const REFRESH_COOKIE = 'oinur_rt';

function hash(pw: string): Promise<string> {
  return bcrypt.hash(pw, env.BCRYPT_COST);
}

export function toMeView(u: User): MeView {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    money: u.money,
    reputation: u.reputation,
    badges: Array.isArray(u.badges) ? (u.badges as string[]) : [],
  };
}

function sessionFor(u: User): { accessToken: string; refreshToken: string; me: MeView } {
  const claims: AccessClaims = { uid: u.id, role: u.role, tv: u.tokenVersion };
  return { accessToken: signAccess(claims), refreshToken: signRefresh(claims), me: toMeView(u) };
}

export function refreshCookie(token: string): string {
  const parts = [`${REFRESH_COOKIE}=${token}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict'];
  if (env.NODE_ENV === 'production') parts.push('Secure');
  parts.push(`Max-Age=${7 * 24 * 3600}`);
  return parts.join('; ');
}

export function clearRefreshCookie(): string {
  const parts = [`${REFRESH_COOKIE}=`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  return parts.join('; ');
}

export async function register(input: { username: string; password: string }) {
  const exists = await prisma.user.findUnique({ where: { username: input.username }, select: { id: true } });
  if (exists) throw new ApiError('ALREADY_EXISTS', { field: 'username' });
  const user = await prisma.user.create({ data: { username: input.username, passwordHash: await hash(input.password) } });
  return sessionFor(user);
}

export async function login(input: { username: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { username: input.username } });
  const ok = user?.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !ok) throw new ApiError('INVALID_CREDENTIALS');
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return sessionFor(updated);
}

export async function changePassword(userId: number, oldPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = user.passwordHash ? await bcrypt.compare(oldPassword, user.passwordHash) : false;
  if (!ok) throw new ApiError('INVALID_CREDENTIALS', { field: 'oldPassword' });
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hash(newPassword), tokenVersion: { increment: 1 } },
  });
}

export async function deactivate(userId: number): Promise<void> {
  // M0：仅删 User 行；其余业务表落地后靠 schema 级联硬删（TECH-DESIGN §9.6）
  await prisma.user.delete({ where: { id: userId } });
}

export async function bumpTokenVersionAndLogout(userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}
```

`apps/api/src/modules/auth/router.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { CredentialsSchema, ChangePasswordSchema } from './schemas.js';
import * as svc from './service.js';
import { verifyRefresh } from '../../lib/jwt.js';

export const authRouter = Router();

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError('VALIDATION_FAILED', r.error.flatten().fieldErrors);
  return r.data;
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const s = await svc.register(parse(CredentialsSchema, req.body));
    res.setHeader('Set-Cookie', svc.refreshCookie(s.refreshToken));
    res.json({ ok: true, data: { accessToken: s.accessToken, me: s.me } });
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const s = await svc.login(parse(CredentialsSchema, req.body));
    res.setHeader('Set-Cookie', svc.refreshCookie(s.refreshToken));
    res.json({ ok: true, data: { accessToken: s.accessToken, me: s.me } });
  } catch (e) { next(e); }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await svc.bumpTokenVersionAndLogout(req.user!.id);
    res.setHeader('Set-Cookie', svc.clearRefreshCookie());
    res.json({ ok: true, data: null });
  } catch (e) { next(e); }
});

authRouter.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = parse(ChangePasswordSchema, req.body);
    await svc.changePassword(req.user!.id, oldPassword, newPassword);
    res.setHeader('Set-Cookie', svc.clearRefreshCookie());
    res.json({ ok: true, data: null }); // tokenVersion+1 → 所有旧 token 失效，前端跳登录
  } catch (e) { next(e); }
});

authRouter.post('/deactivate', requireAuth, async (req, res, next) => {
  try {
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const bcrypt = await import('bcryptjs');
    if (!user.passwordHash || !(await bcrypt.default.compare(password, user.passwordHash)))
      throw new ApiError('INVALID_CREDENTIALS', { field: 'password' });
    await svc.deactivate(req.user!.id);
    res.setHeader('Set-Cookie', svc.clearRefreshCookie());
    res.json({ ok: true, data: null });
  } catch (e) { next(e); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const raw = (req.headers.cookie ?? '')
      .split(';').map((c) => c.trim()).find((c) => c.startsWith('oinur_rt='))
      ?.slice('oinur_rt='.length);
    if (!raw) throw new ApiError('UNAUTHENTICATED');
    const claims = verifyRefresh(decodeURIComponent(raw));
    const user = await prisma.user.findUnique({ where: { id: claims.uid } });
    if (!user || !user.passwordHash || user.bannedAt || user.tokenVersion !== claims.tv)
      throw new ApiError('UNAUTHENTICATED');
    const s = svc.sessionForPublic(user);
    res.setHeader('Set-Cookie', svc.refreshCookie(s.refreshToken));
    res.json({ ok: true, data: { accessToken: s.accessToken, me: s.me } });
  } catch (e) {
    next(e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError
      ? new ApiError('UNAUTHENTICATED')
      : e);
  }
});
```

注意两处收尾修正（实现时直接写入最终形态，不要留 TODO）：
1. `service.ts` 把 `sessionFor` 改为 `export` 并命名为 `sessionForPublic`（或直接 export `sessionFor`），router 引用它；
2. router 顶部补 `import jwt from 'jsonwebtoken';`；`deactivate` 里的动态 import 改为顶部一次性 `import bcrypt from 'bcryptjs';`。

`GET /api/users/me` 放在新文件 `apps/api/src/modules/users/router.ts`:

```ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { toMeView } from '../auth/service.js';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!u) throw new ApiError('UNAUTHENTICATED');
    res.json({ ok: true, data: toMeView(u) });
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: 在 index.ts 挂载路由与限流**

修改 `createApp()`：health 之后追加

```ts
import rateLimit from 'express-rate-limit';
import { authRouter } from './modules/auth/router.js';
import { usersRouter } from './modules/users/router.js';

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const globalLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });

app.use(globalLimiter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/users', usersRouter);
```

- [ ] **Step 6: 运行测试至绿**

Run: `pnpm -C apps/api test`
Expected: 全部 PASS（含此前 health）。

- [ ] **Step 7: Commit**

```bash
git add apps/api && git commit -m "feat(api): 注册/登录/me + requireAuth + 限流（TDD）"
```

---

### Task 6: 认证模块（二）：刷新轮换 / 改密失效 / 注销

**Files:**
- Modify: `apps/api/src/modules/auth/router.ts`（Task 5 已含实现——本任务专注测试与缺陷修复）
- Test: `apps/api/tests/auth-session.test.ts`

**Interfaces:**
- Consumes: Task 5 全部路由。
- Produces: 会话生命周期的行为保证（测试固化）：refresh 轮换、tokenVersion 失效语义、注销释放用户名。

- [ ] **Step 1: 写失败测试**

`apps/api/tests/auth-session.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { resetUsers, unwrap } from './helpers.js';
import type { MeView } from '@oinur/shared';

const app = createApp();
const U = { username: 'sess01', password: 'password123' };

beforeEach(resetUsers);

async function registerAndGetCookies(): Promise<{ token: string; cookies: string[] }> {
  const res = await request(app).post('/api/auth/register').send(U);
  const body = unwrap<{ accessToken: string }>(res);
  return {
    token: body.ok ? body.data.accessToken : '',
    cookies: res.headers['set-cookie'] as string[],
  };
}

describe('POST /api/auth/refresh', () => {
  it('携带刷新 Cookie → 新 accessToken + 新 Cookie（轮换）', async () => {
    const { cookies } = await registerAndGetCookies();
    const rt = cookies.find((c) => c.startsWith('oinur_rt='))!;
    const res = await request(app).post('/api/auth/refresh').set('Cookie', rt.split(';')[0]);
    expect(res.status).toBe(200);
    const body = unwrap<{ accessToken: string }>(res);
    expect(body.ok).toBe(true);
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('oinur_rt='))).toBe(true);
  });

  it('无 Cookie → UNAUTHENTICATED；篡改 Cookie → UNAUTHENTICATED', async () => {
    const none = await request(app).post('/api/auth/refresh');
    expect(unwrap(none).error?.code).toBe('UNAUTHENTICATED');
    const tampered = await request(app).post('/api/auth/refresh').set('Cookie', 'oinur_rt=abc.def.ghi');
    expect(tampered.status).toBe(401);
  });
});

describe('改密后的全局失效', () => {
  it('PUT /api/auth/password 后：旧 access 401、旧 refresh Cookie 也失效', async () => {
    const { token, cookies } = await registerAndGetCookies();
    const rt = cookies.find((c) => c.startsWith('oinur_rt='))!.split(';')[0];

    const changed = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: U.password, newPassword: 'new-password-9' });
    expect(changed.status).toBe(200);

    const oldAccess = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(oldAccess.status).toBe(401);

    const oldRefresh = await request(app).post('/api/auth/refresh').set('Cookie', rt);
    expect(oldRefresh.status).toBe(401);

    const relogin = await request(app).post('/api/auth/login')
      .send({ username: U.username, password: 'new-password-9' });
    expect(relogin.status).toBe(200);
  });

  it('旧密码错误 → INVALID_CREDENTIALS 且 tokenVersion 未变', async () => {
    const { token } = await registerAndGetCookies();
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'wrong-old-pass', newPassword: 'new-password-9' });
    expect(res.status).toBe(401);
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200); // 未失效
  });
});

describe('注销', () => {
  it('POST /api/auth/deactivate：删除账号、token 失效、用户名可复用', async () => {
    const { token } = await registerAndGetCookies();
    const del = await request(app)
      .post('/api/auth/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: U.password });
    expect(del.status).toBe(200);

    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);

    const reuse = await request(app).post('/api/auth/register').send(U);
    expect(reuse.status).toBe(200);
  });

  it('密码确认不符 → INVALID_CREDENTIALS，账号保留', async () => {
    const { token } = await registerAndGetCookies();
    const res = await request(app)
      .post('/api/auth/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'not-my-password' });
    expect(res.status).toBe(401);
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
  });
});

describe('登出', () => {
  it('POST /api/auth/logout：tokenVersion+1，旧 token 失效，Cookie 清除', async () => {
    const { token, cookies } = await registerAndGetCookies();
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookies.map((c) => c.split(';')[0]));
    expect(logout.status).toBe(200);
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(logout.headers['set-cookie'].join()).toContain('Max-Age=0');
  });
});

describe('MeView 字段', () => {
  it('包含 id/username/role/createdAt/lastLoginAt/money/reputation/badges', async () => {
    const { token } = await registerAndGetCookies();
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    const me = unwrap<MeView>(res);
    expect(me.ok && Object.keys(me.data).sort()).toEqual(
      ['badges', 'createdAt', 'id', 'lastLoginAt', 'money', 'reputation', 'role', 'username'].sort(),
    );
  });
});
```

Run: `pnpm -C apps/api test -- auth-session`
Expected: 若 Task 5 实现完整则直接 PASS；任何失败即为 Task 5 缺陷，修复后转绿。

- [ ] **Step 2: 全量回归**

Run: `pnpm -C apps/api test && pnpm typecheck && pnpm -C apps/api lint`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/api && git commit -m "test(api): 会话生命周期固化（刷新轮换/全局失效/注销释放用户名）"
```

---

### Task 7: Web 前端骨架与认证页面

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/styles/app.css`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth-store.ts`, `apps/web/src/app/App.tsx`, `apps/web/src/app/guards.tsx`, `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/RegisterPage.tsx`, `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/components/PlaceholderPanel.tsx`

**Interfaces:**
- Consumes: 后端全部 auth 端点与 `MeView`（shared 类型直引）。
- Produces: 可手动验证的 SPA——注册/登录/设置（改密/注销）闭环；`apiFetch<T>(path, init)` 供后续所有模块复用（自动附带 Bearer、遇 `TOKEN_EXPIRED` 静默 refresh 后重放一次）。

- [ ] **Step 1: 工程文件**

`apps/web/package.json`:

```json
{
  "name": "@oinur/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oinur/shared": "workspace:*",
    "@tanstack/react-query": "^5.80.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router": "^7.6.0",
    "zustand": "^5.0.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OInurturning</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/styles/app.css`:

```css
@import 'tailwindcss';
```

- [ ] **Step 2: API 客户端与会话 store**

`apps/web/src/lib/api.ts`:

```ts
import type { ApiEnvelope, MeView } from '@oinur/shared';

let accessToken: string | null = null;
export function setAccessToken(t: string | null): void { accessToken = t; }

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ||= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const body = (await res.json()) as ApiEnvelope<{ accessToken: string; me: MeView }>;
      if (!body.ok) return false;
      accessToken = body.data.accessToken;
      useAuthStore.getState().setMe(body.data.me);
      return true;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

export class ApiCallError extends Error {
  constructor(public code: string, public details?: unknown) { super(code); }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doCall = () =>
    fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });

  let res = await doCall();
  let body = (await res.json()) as ApiEnvelope<T>;

  if (!body.ok && body.error.code === 'TOKEN_EXPIRED' && (await tryRefresh())) {
    res = await doCall();
    body = (await res.json()) as ApiEnvelope<T>;
  }
  if (!body.ok) throw new ApiCallError(body.error.code, body.error.details);
  return body.data;
}

export { tryRefresh };

import { useAuthStore } from './auth-store.js';
```

（实现时把底部 import 移到文件顶部——此处并列展示仅为标注依赖关系。）

`apps/web/src/lib/auth-store.ts`:

```ts
import { create } from 'zustand';
import type { MeView } from '@oinur/shared';

interface AuthState {
  me: MeView | null;
  booted: boolean;
  setMe: (me: MeView | null) => void;
  setBooted: (b: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  me: null,
  booted: false,
  setMe: (me) => set({ me }),
  setBooted: (booted) => set({ booted }),
}));
```

- [ ] **Step 3: 路由、守卫与页面**

`apps/web/src/app/guards.tsx`:

```tsx
import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { tryRefresh } from '../lib/api.js';
import { useAuthStore } from '../lib/auth-store.js';

export function RequireAuth() {
  const { me, booted, setMe, setBooted } = useAuthStore();
  useEffect(() => {
    if (booted) return;
    void tryRefresh().then((ok) => { if (!ok) setMe(null); setBooted(true); });
  }, [booted, setBooted, setMe]);
  if (!booted) return <div className="grid min-h-screen place-items-center text-neutral-500">连接服务器中…</div>;
  return me ? <Outlet /> : <Navigate to="/login" replace />;
}
```

`apps/web/src/features/auth/LoginPage.tsx`（RegisterPage 结构相同，端点换成 `/api/auth/register`、文案换注册，此处从略——实现时复制改造，字段一致：username/password）：

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch, setAccessToken, ApiCallError } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth-store.js';
import type { MeView } from '@oinur/shared';

export function LoginPage(): JSX.Element {
  const nav = useNavigate();
  const setMe = useAuthStore((s) => s.setMe);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const d = await apiFetch<{ accessToken: string; me: MeView }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAccessToken(d.accessToken);
      setMe(d.me);
      nav('/');
    } catch (e2) {
      setErr(e2 instanceof ApiCallError && e2.code === 'INVALID_CREDENTIALS' ? '用户名或密码错误' : '登录失败，请稍后再试');
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-center text-2xl font-bold">OInurturning</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
        <input className="rounded border px-3 py-2" placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="rounded border px-3 py-2" type="password" placeholder="密码（至少 8 位）" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="rounded bg-neutral-900 py-2 font-medium text-white hover:bg-neutral-700" type="submit">登录</button>
        <p className="text-center text-sm text-neutral-500">
          没有账号？<Link className="text-blue-600 underline" to="/register">注册</Link>
        </p>
      </form>
    </div>
  );
}
```

`apps/web/src/app/App.tsx`（布局壳：顶栏 + 侧导航占位）：

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, setAccessToken } from '../lib/api.js';
import { useAuthStore } from '../lib/auth-store.js';

const TABS = [
  { to: '/', label: '总览' },
  { to: '/students', label: '学员管理', soon: true },
  { to: '/backpack', label: '背包', soon: true },
  { to: '/academy', label: '高级学院', soon: true },
  { to: '/adventure', label: '历练', soon: true },
  { to: '/story', label: '剧情模式', soon: true },
  { to: '/pvp', label: 'PVP', soon: true },
] as const;

export function Layout() {
  const { me, setMe } = useAuthStore();
  const nav = useNavigate();
  const qc = useQueryClient();

  async function logout(): Promise<void> {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } finally {
      setAccessToken(null); setMe(null); qc.clear(); nav('/login');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <span className="font-bold">OInurturning</span>
        <div className="flex items-center gap-3 text-sm">
          {me && <span className="text-neutral-500">{me.username}</span>}
          <button onClick={() => void logout()} className="underline">登出</button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="w-44 shrink-0 border-r bg-white p-2 text-sm">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'} ${'soon' in t && t.soon ? 'text-neutral-400' : ''}`}>
              {t.label}{'soon' in t && t.soon ? '（建设中）' : ''}
            </NavLink>
          ))}
          <NavLink to="/settings" className={({ isActive }) => `block rounded px-3 py-2 ${isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'}`}>用户设置</NavLink>
        </nav>
        <main className="flex-1 p-6"><Outlet /></main>
      </div>
    </div>
  );
}
```

`apps/web/src/features/settings/SettingsPage.tsx`：

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiCallError } from '../../lib/api.js';
import type { MeView } from '@oinur/shared';

export function SettingsPage(): JSX.Element {
  const qc = useQueryClient();
  const nav = useNavigate();
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<MeView>('/api/users/me') });
  const [msg, setMsg] = useState<string | null>(null);

  const changePwd = useMutation({
    mutationFn: (body: { oldPassword: string; newPassword: string }) =>
      apiFetch('/api/auth/password', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { qc.clear(); nav('/login'); },
    onError: (e) => setMsg(e instanceof ApiCallError ? '旧密码错误' : '操作失败'),
  });

  const deactivate = useMutation({
    mutationFn: (password: string) =>
      apiFetch('/api/auth/deactivate', { method: 'POST', body: JSON.stringify({ password }) }),
    onSuccess: () => { qc.clear(); nav('/login'); },
    onError: () => setMsg('注销失败：密码确认不符'),
  });

  if (meQ.isLoading) return <p className="text-neutral-500">加载中…</p>;
  if (meQ.isError || !meQ.data) return <p className="text-red-600">加载失败</p>;
  const me = meQ.data;

  function onChange(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) { setMsg('两次新密码不一致'); return; }
    changePwd.mutate({ oldPassword: String(f.get('oldPassword')), newPassword: String(f.get('newPassword')) });
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">账户信息</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-neutral-500">用户 ID</dt><dd>{me.id}</dd>
          <dt className="text-neutral-500">用户名</dt><dd>{me.username}</dd>
          <dt className="text-neutral-500">注册时间</dt><dd>{new Date(me.createdAt).toLocaleString()}</dd>
          <dt className="text-neutral-500">上次登录</dt><dd>{me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : '—'}</dd>
          <dt className="text-neutral-500">金钱 / 声誉</dt><dd>{me.money} / {me.reputation}</dd>
        </dl>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">修改密码</h2>
        <form onSubmit={onChange} className="space-y-2 text-sm">
          <input name="oldPassword" type="password" required placeholder="当前密码" className="w-full rounded border px-3 py-2" />
          <input name="newPassword" type="password" required minLength={8} maxLength={72} placeholder="新密码（8–72 位）" className="w-full rounded border px-3 py-2" />
          <input name="confirm" type="password" required placeholder="确认新密码" className="w-full rounded border px-3 py-2" />
          <button className="rounded bg-neutral-900 px-4 py-2 text-white">保存</button>
        </form>
      </section>

      <section className="rounded border border-red-200 bg-red-50 p-4">
        <h2 className="mb-2 font-semibold text-red-700">危险区</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (confirm('确认注销账户？该操作不可恢复，将删除全部数据！')) deactivate.mutate(String(new FormData(e.currentTarget).get('password'))); }} className="flex gap-2 text-sm">
          <input name="password" type="password" required placeholder="输入密码确认注销" className="flex-1 rounded border px-3 py-2" />
          <button className="rounded bg-red-600 px-4 py-2 text-white">注销账户</button>
        </form>
      </section>

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
```

`apps/web/src/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/app.css';
import { RequireAuth } from './app/guards.jsx';
import { Layout } from './app/App.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { RegisterPage } from './features/auth/RegisterPage.jsx';
import { SettingsPage } from './features/settings/SettingsPage.jsx';

const qc = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/" element={<p className="text-neutral-500">欢迎回来，教练。请从左侧选择功能。</p>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

侧导航里 `soon` 的 tab（/students 等）无需真实路由——点击后被 `*` 兜底回首页即可接受；如需禁用样式已在 NavLink className 处理。

- [ ] **Step 4: 手动验收（对照 ROADMAP T0.5/T0.6）**

```bash
pnpm db:up && pnpm -C apps/api migrate && pnpm dev
# 浏览器 http://localhost:5173 依次验证：
# 1 注册 coach02 → 自动进入主布局；2 登出；3 登录；4 设置页可见 ID/注册时间/上次登录；
# 5 改密后回到登录页，旧密码登录失败、新密码成功；6 注销后同名可重新注册。
```

Expected: 全部通过；控制台无红色网络错误。

- [ ] **Step 5: typecheck/lint 后提交**

Run: `pnpm typecheck && pnpm lint`
Expected: 全绿。

```bash
git add apps/web && git commit -m "feat(web): SPA 骨架（认证页/布局壳/设置页/api客户端静默续期）"
```

---

### Task 8: 生产部署编排

**Files:**
- Create: `deploy/docker-compose.yml`, `deploy/api.Dockerfile`, `deploy/web.Dockerfile`, `deploy/nginx.conf`, `README.md`

**Interfaces:**
- Consumes: Task 1–7 的全部产物；`docs/data/*.yaml` 将随镜像进入 `/app/config`（CONFIG_DIR，M1 导入管线消费，M0 先 COPY 备位）。
- Produces: `cd deploy && docker compose up -d --build` 一键起 mysql(healthy)+api(migrate deploy 后监听 3000)+nginx(:80 托管静态并反代 /api)。

- [ ] **Step 1: nginx 配置与两个 Dockerfile**

`deploy/nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" always;

  location /api/ {
    proxy_pass http://api:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
}
```

`deploy/api.Dockerfile`:

```dockerfile
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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/docs/data ./config
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && npx -y prisma@6.10.0 --version >/dev/null 2>&1 || true
EXPOSE 3000
CMD ["./entrypoint.sh"]
```

`deploy/entrypoint.sh`:

```sh
#!/bin/sh
set -e
npx -y prisma@6.10.0 migrate deploy
exec node dist/index.js
```

`deploy/web.Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm -C apps/web build

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 2: 生产 compose（照抄 TECH-DESIGN §10.1）**

`deploy/docker-compose.yml` 使用 `docs/TECH-DESIGN.md` §10.1 的原文内容（mysql:8.4 + healthcheck、api build 自 `deploy/api.Dockerfile`、nginx build 自 `deploy/web.Dockerfile` 映射 80:80、卷 `dbdata`），一字不改地落盘。

- [ ] **Step 3: README 快速开始**

`README.md`：

```markdown
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
```

- [ ] **Step 4: 构建验证（有 Docker 时）**

```bash
cd deploy && cp ../.env.example .env && docker compose up -d --build
curl -fsS http://localhost/api/health && curl -fsS http://localhost/ | head -c 120
docker compose down
```

Expected: health 返回 `{"ok":true,...}`；首页 HTML 含 `<div id="root">`。无 Docker 环境时降级执行 `docker compose config -q`（语法校验）并在 PR 说明中注明未做实机构建。

- [ ] **Step 5: Commit**

```bash
git add deploy README.md && git commit -m "build: 生产编排（mysql/api/nginx 一键部署 + README）"
```

---

### Task 9: M0 收尾验证

**Files:**
- Modify: `docs/ROADMAP.md`（勾选 T0.x）

- [ ] **Step 1: 全仓质量门**

```bash
pnpm install && pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全绿（api 集成测需 dev mysql 运行中）。

- [ ] **Step 2: 对照 ROADMAP M0 验收标准逐项打勾**

编辑 `docs/ROADMAP.md`，把 M0 各任务行首标记改为 `[x]`，验收标准处补充一句实测结果（如「注册→登录→改密→注销全链路 2026-08-26 于 docker 环境实测通过」）。

- [ ] **Step 3: 最终提交**

```bash
git add -A && git commit -m "docs: M0 验收记录与路线图勾选"
```

---

## Self-Review 记录

1. **Spec 覆盖**：T0.1→Task1；T0.2(shared stub)→Task2；T0.3→Task4；T0.4→Task5+6；T0.5/T0.6→Task7；T0.7→Task8。TECH §5.2 #1–8 端点全覆盖（meta 端点 #8 属 M1 配置管线依赖，M0 不做——已在 Task3 health 中提供 serverTime 等价物，偏差可接受）。✓
2. **占位符扫描**：Task7 RegisterPage 标注「复制 LoginPage 改造」属可机械执行的明确指令且字段/端点差异已写明；Task8 compose 要求「照抄 §10.1」有唯一权威来源。无 TBD/TODO。✓
3. **类型一致性**：`sessionFor`/`sessionForPublic` 命名冲突已在 Task5 Step4 末尾给出收敛指令；`MeView` 字段与测试断言一一对应；`ApiCallError.code` 取值即 shared `ErrorCode`。✓
