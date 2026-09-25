# OInurturning 运维手册（M5 T5.4 上线检查单）

> 版本：v0.1（2026-09-09）｜配套：`deploy/`（compose/Dockerfile/backup.sh）、`.env.example`、TECH-DESIGN §9/§10。
> 本文是**上线执行文档**：给出每项检查的可执行命令与通过标准；浏览器/Docker 冒烟需在部署窗口执行。

---

## 0. 快速部署

```bash
# 1) 准备 .env（生产）
cd deploy && cp ../.env.example .env
#    必改：MYSQL_ROOT_PASSWORD、MYSQL_PASSWORD、JWT_SECRET（pnpm secret 生成，勿用占位值）
# 2) 一键起栈（构建镜像含 Prisma Client；mysql 健康后 api entrypoint 自动 migrate deploy，nginx 暴露 :80）
docker compose up -d --build
# 3) 探活
curl -s localhost/api/health
#    期望 {"ok":true,"data":{"configVersion":"<12位hash>",…}}
docker compose ps          # 三容器 healthy/Up
```

> `:?set in .env` 语法保证遗漏必填环境变量时 compose 直接报错，而不是带病启动。

---

## 1. 上线检查单（目标：全绿）

| # | 检查项 | 通过标准 | 命令/位置 |
|---|---|---|---|
| 1 | 数据库持久化 | `dbdata` 卷存在，容器重建不丢数据 | `docker volume ls` |
| 2 | 启动即迁移 | api 容器日志无 migrate 失败 | `docker compose logs api \| grep -i migrate` |
| 3 | 配置即数据导入 | `/api/health` 返回非空 `configVersion` | `curl -s localhost/api/health` |
| 4 | JWT_SECRET 强随机 | `.env` 非占位、≥32B；production 守卫通过 | `grep -c '^JWT_SECRET=change-me\|xxxxxxx' deploy/.env` 输出 0；重启 api 无 `[env]` 拒绝 |
| 5 | bcrypt cost | `.env` `BCRYPT_COST` ∈ [10,14]（默认 12） | `grep '^BCRYPT_COST' deploy/.env` |
| 6 | 限流基线生效 | 全局 300 req/min/IP、auth 10 req/15min/IP | env 覆盖见 §5；`tests/rate-limit.test.ts` 绿 |
| 7 | 管理员账号就绪 | 至少一名 ADMIN 可登录进 `/admin` | §6 `admin:set promote <你>`, UI 走查 |
| 8 | 访问日志 | api 容器 stdout 有 `http request` JSON 行（方法/路径/状态码/耗时/requestId） | `docker compose logs api` |
| 9 | 日志轮转 | compose json-file `max-size/max-file` 生效（api 20m×5、mysql/nginx 10m×3） | `docker inspect oinur-api --format '{{.HostConfig.LogConfig}}'` |
| 10 | 每日备份 cron | 宿主机 crontab 已装；手跑一次成功 | §4 备份；`ls -la /var/backups/oinur` |
| 11 | 恢复演练 | 备份可导入临时库 | §4 恢复命令（建议每月一次） |
| 12 | 安全响应头 | nginx 四头齐全（nosniff/XFO DENY/Referrer-Policy/CSP） | `curl -sI localhost/ \| grep -i 'x-content\|x-frame\|referrer\|content-security'` |
| 13 | 上传/体积限制 | nginx `client_max_body_size 1m`、express json 256kb | nginx.conf / index.ts |
| 14 | 探活与重启 | 三容器 `restart: unless-stopped` | `docker compose ps` |
| 15 | 浏览器冒烟 | 注册→登录→各主页面/战报走查通过 | 部署窗口人工走查 |

## 2. 首次上线顺序

1. `deploy/backup.sh` 手跑一次（§4）验证备份可用；
2. 装 crontab 每日备份（§4）；
3. `docker compose up -d --build`；
4. `curl localhost/api/health` 绿；
5. 注册主账号 → `pnpm admin:set promote <username>`（§6）→ 登录 `/admin` 走查；
6. 验证 nginx 安全头与日志轮转（表 #9/#12）。

## 3. 环境变量（生产 .env）

| 变量 | 必填 | 说明 |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | 是 | compose 强校验 |
| `MYSQL_DATABASE` / `MYSQL_USER` | 否 | 默认 oinur/oinur |
| `JWT_SECRET` | 是 | `pnpm secret` 生成；production 拒绝占位值 |
| `BCRYPT_COST` | 否 | 默认 12 |
| `LOG_LEVEL` | 否 | pino 级别，默认 info |
| `RATE_LIMIT_*` | 否 | §5 限流覆盖；`deploy/docker-compose.yml` 已透传，未设即基线（默认值与代码 env.ts 一致） |
| `CONFIG_DIR` | 容器内 | /app/config（勿改） |

## 4. 备份与恢复

```bash
# 手跑一次（容器须在运行；凭据取自容器环境，宿主机不落密码）
deploy/backup.sh                        # → /var/backups/oinur/oinur-YYYYmmdd-HHMMSS.sql.gz
BACKUP_DIR=/data/backups RETENTION_DAYS=30 deploy/backup.sh   # 可调目录/保留期

# 装 crontab（每日 04:00，日志另存）
crontab -e
# 0 4 * * * /path/to/oinur/deploy/backup.sh >> /var/log/oinur-backup.log 2>&1

# 恢复演练（导到临时库验证；每月建议一次）
gunzip < /var/backups/oinur/oinur-YYYYmmdd-HHMMSS.sql.gz \
  | docker exec -i oinur-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

# 异机灾备（可选，一行）
rsync -a /var/backups/oinur/ backup@offsite:/var/backups/oinur/
```

要点：`mysqldump --single-transaction --quick`（InnoDB MVCC 快照，不锁表）；退出码非 0 不落盘不清理；保留 14 天默认。

## 5. 限流

基线（内存桶，单实例前提，TECH-DESIGN §9.3/§12 T7）：

| 作用域 | 默认 | env 覆盖 |
|---|---|---|
| 全局 | 300 req/min/IP | `RATE_LIMIT_GLOBAL_MAX` / `RATE_LIMIT_WINDOW_MS` |
| /api/auth | 10 req/15min/IP | `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW_MS` |

命中返回统一信封 `{"ok":false,"error":{"code":"RATE_LIMITED"}}`（429）。若将来多实例，限流桶需换 Redis 存储（TECH-DESIGN §12 T7 升级路径）。

## 5.1 登录态与 HTTPS

刷新登录态依赖 `oinur_rt` HttpOnly Cookie。API 会根据实际请求协议设置 `Secure`：HTTPS（包括可信反代转发的 HTTPS）必带 `Secure`；直接 HTTP 仅用于本地或临时自托管兼容，**不具备传输安全性**。

生产环境必须在公网入口终结 TLS。若 nginx 前还有一层反代，设置 `TRUST_PROXY_HOPS` 为可信代理层数（本仓 `deploy/docker-compose.yml` 的 nginx → API 默认值为 `1`），并确保外层传递 `X-Forwarded-Proto: https`。部署后以“登录 → 浏览器刷新 → 仍处于已登录页面”验收。

## 6. 管理员初始化

```bash
# 方式 A（推荐，已有注册账号）：提升为 ADMIN；旧会话自动失效需重登
pnpm admin:set promote <username>

# 方式 B（首次启动无账号）：直接创建首个管理员（密码 ≥8 位）
pnpm admin:set create <username> <password>
```

两种都写 `AdminAuditLog`（action=`ADMIN_BOOTSTRAP`，首个 actor 记 system），审计留痕不绕过；幂等：已是 ADMIN 直接成功退出。

## 7. 日志

- pino JSON → 容器 stdout：错误经 `errorHandler` 带 `{err, requestId}`；HTTP 访问日志 `http request`（不记 body/header，天然免 redact）；
- 查看：`docker compose logs -f api`；本地开发 `| pino-pretty`；
- 轮转：compose `logging.options`（见上表 #9），无需宿主 logrotate。

## 8. 常见操作

```bash
docker compose up -d --build   # 升级（含新迁移，entrypoint 自动 migrate deploy）
docker compose restart api     # 只重启 api（配置 yaml 改动后）
docker compose down            # 停（不删卷；删数据用 down -v，谨慎）
docker compose exec mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
```

## 9. 开局包回填（存量裸号）

开局包上线前已存在的账号（`onboardedAt` 为空）不会自动获得钱/声誉/学员/道具/招募池，用回填脚本补发（与注册同一发放函数，口径一致）：

```bash
# 先 dry-run 看影响面（只读，不写库）
pnpm -C apps/api onboarding:backfill --dry-run

# 正式回填（可加 --limit N 分批；缺省 10000）
pnpm -C apps/api onboarding:backfill
pnpm -C apps/api onboarding:backfill --limit 500
```

- 目标：`onboardedAt` 为空的用户（注销即物理删除，不存在「已注销但仍留库」的行）；已发放自动跳过；
- 幂等：按 `onboardedAt` 标记，重复执行不翻倍（钱/声誉走 increment、道具走 upsert-increment）；
- 逐用户独立事务：单用户失败记日志继续，不影响其他用户，事后重跑即可补齐。

## 10. 注销硬删迁移（不可逆，务必先备份）

迁移 `20260913000000_hard_delete_users` 把注销从软删改为物理删除（TECH-DESIGN §9.6），
随 `docker compose up -d --build` 由 entrypoint 自动 `migrate deploy` 执行。它会：

1. 把 `AdminAnnouncement.authorId` 外键改为 `SET NULL`（公告不再随作者注销被删）；
2. `DELETE FROM users WHERE deletedAt IS NOT NULL`——**级联清空历史软删账号的全部业务数据并释放其用户名**；
3. `DROP COLUMN users.deletedAt`。

上线前后要点：

```bash
# 1) 执行前必备份（第 2 步不可逆，删掉的数据无法恢复）
deploy/backup.sh

# 2) 先看影响面：有多少历史软删账号会被清除（只读）
docker compose exec mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
   -e "SELECT COUNT(*) AS soft_deleted FROM users WHERE deletedAt IS NOT NULL;"'

# 3) 升级并确认迁移已应用
docker compose up -d --build
docker compose exec mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
   -e "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;"'
```

- 第 2、3 步顺序不可调换：否则已注销管理员名下的全站公告会被旧的 `CASCADE` 规则连带删除；
- 迁移后这些用户名立即可被重新注册，新账号是**全新 id、零数据**，与旧账号无任何关联，客服侧不要按旧 id 追溯；
- 注销后的用户数据不可恢复（无软删标记、无回收站）；误注销只能从备份库单表捞回，属事故级操作；
- 玩家侧行为变化：进行中（`REGISTERING`/`RUNNING`）PVP 赛事的参赛者注销会被拒（`409 STATE_CONFLICT`），
  前端提示「等赛事结束后再注销」，赛事 `FINISHED`/`CANCELLED` 后即可注销。

## 11. 强制新手引导的上线与放行

引导（`docs/data/tutorial.yaml`，当前 10 步）在服务端由 `apps/api/src/index.ts` 的全局守卫执行；未完成引导的账号只放行
`/api/tutorial`、`/api/overview`、`/api/users/me`、`/api/auth`、`/api/talents`，其余端点一律 `403 FORBIDDEN`
（`details.resource === 'tutorial'`）。前端对应地禁用侧栏未解锁项，并在深链时重定向到 `/`。

**上线前必做：先跑开局包回填**

迁移 `20260923000000_tutorial_shop` 把存量账号一律置为 `tutorialStep=0 / tutorialCompleted=0`
（产品决策：不回填，升级后所有既有账号需重走一遍引导）。因此**在升级前**必须确认没有"零学员"账号——
引导第 2 步要求完成一次训练，没有学员的账号会永久卡死。先按 §9 回填：

```bash
pnpm -C apps/api onboarding:backfill --dry-run   # 看影响面
pnpm -C apps/api onboarding:backfill             # 正式补发（幂等）
```

**升级后玩家可见的变化**

| 项 | 说明 |
|---|---|
| 老账号 | 被锁在总览/学员/引导自身；完成 10 步后全部解锁（含 PVP、管理端） |
| 招募步（`recruit`） | 条件式：在册 ACTIVE 学员 **≥4** 即自动通过，不强制发生招募（招募费随在册人数指数增长 `round(300×1.35^n)`，强制招募会让 10 人老号掏 6000+ 金） |
| 招募步之前的钱不够 | 该步已解锁讲课与历练（挣钱路径），可先赚钱再招人；welcome 步另发 200 训练金 |
| 管理端 | ADMIN 角色豁免引导锁，不受影响 |

**个别卡死账号的人工放行**（运维通道，产品上不提供用户可见的"跳过引导"）：

```bash
docker compose exec mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
   -e "UPDATE users SET tutorialStep=999, tutorialCompleted=1 WHERE username='\''<name>'\'';"'
```

**配置依赖**：`tutorial.yaml` 与 `shop.yaml` 已是**必需**配置文件（缺失即启动失败并打印错误表）。
`deploy/api.Dockerfile` 整目录复制 `docs/data`，正常部署不受影响；自建 `CONFIG_DIR` 必须包含这两个文件。

**徽章命名**：完成引导发的是 `onboarding-done`，总览开局任务发的是 `rookie-done`（`overview/service.ts`
的 `CHECKLIST_REWARD_BADGE`，同时被用作"已领取"幂等键）。**两者不得合并**：若引导先发了 `rookie-done`，
总览开局任务会永久显示"已领取"，其领奖被吞。

**未来改 yaml 步序的注意**：插入/删除中间步会让"未完成引导"账号停留在的 `tutorialStep` 语义发生位移
（例如在某步之前插入一步后，原索引 4..8 的账号会落到前一个语义步）。改动前先评估在途账号，必要时按上面的 SQL 放行。
