# T5.4 上线检查单 — 交接报告

> 日期：2026-09-09 ｜ 分支：arena/01a08546-oinurturning
> 权威口径：`docs/ROADMAP.md` M5 T5.4（检查单全绿；Docker/浏览器项留最终部署窗口）+ 新运维文档 `docs/OPERATIONS.md`

## 交付物

| 文件 | 说明 |
|---|---|
| `deploy/backup.sh` | 宿主机每日备份脚本（crontab 一行调用）：`docker exec` 容器内 `mysqldump --single-transaction --quick` → gzip 命名 `oinur-YYYYMMDD-HHMMSS.sql.gz`；凭据取容器环境变量，宿主机不落明文；非 0 退出不落盘不清理；`RETENTION_DAYS` 默认 14 天滚动清理；env 可调 `OINUR_MYSQL_CONTAINER`/`BACKUP_DIR`/`RETENTION_DAYS` |
| `apps/api/src/scripts/set-admin.ts` | 管理员初始化 CLI（`promote \| create`）：promote 幂等、提升时 `tokenVersion+1` 使旧会话失效；create 走 `bcrypt.hash(env.BCRYPT_COST)` 直接建 ADMIN；两者都写 `AdminAuditLog`（action=`ADMIN_BOOTSTRAP`、adminId=null、adminNameSnapshot=`system`、payload 带 mode/username） |
| `scripts/gen-secret.mjs` | JWT_SECRET 生成器：`randomBytes(48).toString('base64')`（64 chars），Node ESM、仓库根工具风格 |
| `apps/api/src/config/env.ts` | 新增 4 个限流 env（zod coerce int positive，缺省即基线）+ production 占位 JWT 护栏（`/^(change-me|.*xxxxxxx)/i` 命中 → 报错 exit 1，提示 `pnpm secret`） |
| `apps/api/src/index.ts` | HTTP 访问日志中间件（非 test 环境；method/url/statusCode/durationMs/requestId，不记 body/头）+ 限流器接 env 参数 |
| `docs/OPERATIONS.md` | 新增运维手册：15 项上线检查单、首次上线顺序、env 表、备份/恢复命令（含 crontab、恢复演练、rsync 异机）、限流基线表、管理员初始化、日志、常见操作 |
| `docs/TECH-DESIGN.md` | §9.3 限流表加 env 覆盖列（预留 60 req/min/user 行标注现状由全局桶覆盖）；§10.2 env 表加 4 项；§10.3 备份 canonical 改为 `deploy/backup.sh` |
| `.env.example` | 加注释示例：4 个限流 env（默认注释掉）；JWT_SECRET 注记「production 拒绝占位值」 |
| 根 `package.json` | `secret`、`admin:set` 根脚本；apps/api 加 `admin:set`（`node --import tsx --env-file=../../.env src/scripts/set-admin.ts`，与 seed 同约定） |

## 上线检查单对照

| # | 检查项 | 本轮落地 | 状态 |
|---|---|---|---|
| 1 | 数据库持久化 | 已有 `dbdata` volume（T 早期） | 部署窗口验 |
| 2 | 启动即迁移 | entrypoint.sh `migrate deploy`（已存在，审计确认） | 部署窗口验 |
| 3 | 配置即数据导入 | `importConfigs()` 启动执行（已存在） | 部署窗口验 |
| 4 | JWT_SECRET 强随机 | `pnpm secret` + production 占位护栏（新增） | ✅ 代码级 |
| 5 | bcrypt cost | env 校验 [10,14] 默认 12（已存在） | ✅ |
| 6 | 限流参数 | env 可调 + 缺省基线（新增）；命中统一 RATE_LIMITED 信封（已有） | ✅ 代码级 |
| 7 | 管理员账号初始化 | set-admin.ts + 审计（新增）；schema 无需迁移 | ✅ 代码级 |
| 8 | 访问日志 | HTTP 访问日志中间件（新增） | ✅ 代码级 |
| 9 | 日志轮转 | compose json-file（已存在：api 20m×5、mysql/web 10m×3） | 部署窗口验 |
| 10 | 每日备份 cron | backup.sh（新增，`sh -n` ✅） | 部署窗口实跑 |
| 11 | 恢复演练 | OPERATIONS.md §4 命令（建议每月） | 部署窗口实跑 |
| 12 | 安全响应头 | nginx.conf 四头（已存在，审计确认） | 部署窗口验 |
| 13 | 上传/体积限制 | nginx 1m、express json 256kb（已存在） | ✅ |
| 14 | 探活与重启 | 三容器 restart: unless-stopped（已存在） | 部署窗口验 |
| 15 | 浏览器冒烟 | — | 部署窗口 |

## 设计取舍

- **备份 canonical 脚本化**：TECH-DESIGN §10.3 原「crontab 两行」合并进单脚本——失败原子性（`.tmp` 落盘 + 成功后 rename + 失败清理）、保留期单点、凭据不落宿主机，同时保留等价手工命令。
- **限流默认值不迁移到 .env.example 活动值**：代码 zod default 即基线，.env.example 只作注释示例——避免「注释与代码两处默认值漂移」，运维只需在需要偏离时显式设置。
- **访问日志**：不引入 pino-http 依赖（保持最小依赖面，与 TECH-DESIGN P5 取舍一致）；`res.on('finish')` 度量、`process.hrtime.bigint()` 计时；测试环境跳过避免刷屏。
- **审计 actor 记 system**：首启时无管理员可作 actor，沿用 `AdminAuditLog.adminId=null + adminNameSnapshot` 快照设计；审计写入与被提升用户同一事务，绝不绕过审计。
- **占位护栏用模式匹配而非仅长度**：长度校验本就存在（≥32），但 .env.example 占位值也超长，故 production 下对 `change-me…`/含 `xxxxxxx` 的串单独拒绝。

## 质量门（沙箱内已过）

- `eslint`（env.ts / index.ts / set-admin.ts）✅ 0 error
- `esbuild --bundle` 语法 + 依赖解析（三文件）✅
- `sh -n deploy/backup.sh` ✅；`node scripts/gen-secret.mjs` 输出 64-char base64 ✅
- `git diff --check` ✅；prettier（涉及 TS/JSON）✅

> **沙箱限制（如实记录）**：prisma generate 需从 binaries.prisma.sh 下载引擎二进制，本沙箱 TLS 不可达 → 全量 `typecheck/test/build`（apps/api）无法在本环境复跑；`@prisma/client` 生成类型缺失导致的全仓 tsc 报错为环境性、非本次改动引入（seed.ts 等未改动文件同样报错）。已做代码级静态门 + 与既有代码模式逐项比对（审计写入对齐 admin/service.ts 的 `Prisma.InputJsonValue` 用法、create 对齐 seed.ts 字面量写法、schema 字段名逐一核对 User/AdminAuditLog）。全量门 + 检查单 #1-#3/#9-#11/#15 按约定在最终部署窗口（联网/有库环境）执行 OPERATIONS.md §1。

## 部署窗口手工清单（OPERATIONS.md 交叉引用）

- [ ] `deploy/backup.sh` 实跑一次并解压抽查；装 crontab；恢复演练到临时库
- [ ] `docker compose up -d --build` → `/api/health` 含 configVersion；migrate 日志无错
- [ ] `docker inspect` 确认日志轮转参数；`docker compose logs api` 见 `http request` 行
- [ ] `.env` 用 `pnpm secret` 的 JWT_SECRET；`NODE_ENV=production` 起 api 验证占位值被拒 / 真值通过
- [ ] `pnpm admin:set promote <已注册用户名>` → 重新登录后 /admin 可进；审计页见 ADMIN_BOOTSTRAP；旧会话确实失效
- [ ] 用 env 调低 `RATE_LIMIT_AUTH_MAX` 快速验证 429 RATE_LIMITED 信封
- [ ] 浏览器冒烟 + 检查单 #1/#2/#3/#9/#11/#14
