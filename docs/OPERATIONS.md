# OInurturning 运维手册（M5 T5.4 上线检查单）

> 版本：v0.1（2026-09-09）｜配套：`deploy/`（compose/Dockerfile/backup.sh）、`.env.example`、TECH-DESIGN §9/§10。
> 本文是**上线执行文档**：给出每项检查的可执行命令与通过标准；浏览器/Docker 冒烟需在部署窗口执行。

---

## 0. 快速部署

```bash
# 1) 准备 .env（生产）
cd deploy && cp ../.env.example .env
#    必改：MYSQL_ROOT_PASSWORD、MYSQL_PASSWORD、JWT_SECRET（pnpm secret 生成，勿用占位值）
# 2) 一键起栈（mysql 健康后 api 自动 migrate deploy，nginx 暴露 :80）
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

- 目标：`onboardedAt` 为空且未注销（`deletedAt` 为空）的用户；已发放/已注销自动跳过；
- 幂等：按 `onboardedAt` 标记，重复执行不翻倍（钱/声誉走 increment、道具走 upsert-increment）；
- 逐用户独立事务：单用户失败记日志继续，不影响其他用户，事后重跑即可补齐。
