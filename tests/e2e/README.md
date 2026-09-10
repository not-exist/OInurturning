# e2e 测试（Playwright）

浏览器级端到端：真 API（`NODE_ENV=test`，`docs/data` 真配置）+ 真前端（vite dev），
共用一个 e2e 库 `oinur_e2e`，**串行**执行（历练有服务端周限流、PVP 需多账号编排）。

| 文件 | 覆盖 |
|---|---|
| `specs/smoke.spec.ts` | 新用户遍历全部页面无崩溃 |
| `specs/auth.spec.ts` | 注册/登录/登出/未登录拦截 |
| `specs/academy.spec.ts` | 候选池/招募/刷新/金币不足 |
| `specs/students.spec.ts` | 列表/档案/改名/开除 |
| `specs/training.spec.ts` | 基础/定向/专项训练 |
| `specs/items.spec.ts` | 背包使用/不可用态/改名卡跳转 |
| `specs/lecture.spec.ts` | 讲课达标/强接/拒单 |
| `specs/problems.spec.ts` | 出题/删除/资源不足 |
| `specs/adventure.spec.ts` | 抽取→preview→分支→回避 |
| `specs/story.spec.ts` | 进关→战报→返回/锁定关 |
| `specs/pvp.spec.ts` | 锦标赛 8 人全周期+领奖 |
| `specs/admin.spec.ts` | 建赛/公告/查用户/审计 |
| `specs/settings.spec.ts` | 账户信息/改密/注销 |
| `specs/full-journey.spec.ts` | **完整玩家旅程**（旗舰） |

API 级全链路旅程（supertest）在 `apps/api/tests/journey-full.e2e.test.ts`，跑在同一个 e2e Action 里。

## 本地运行

```bash
# 1. 起 MySQL（与开发库共实例即可）
pnpm db:up

# 2. 建 e2e 库并迁移（库名须与 E2E_DATABASE_URL 一致）
mysql -h 127.0.0.1 -uoinur -poinur -e "CREATE DATABASE IF NOT EXISTS oinur_e2e;"
DATABASE_URL='mysql://oinur:oinur@127.0.0.1:3306/oinur_e2e' pnpm -C apps/api migrate

# 3. 装 Chromium（只需一次）
pnpm exec playwright install chromium

# 4. 从仓库根运行（webServer 会自动拉起 API+web）
pnpm e2e
```

常用环境变量：`E2E_DATABASE_URL`、`E2E_JWT_SECRET`、`E2E_API_PORT`、`E2E_WEB_PORT`、
`E2E_ADMIN_USER`/`E2E_ADMIN_PASS`。`tests/e2e/.auth/` 为 globalSetup 生成的管理员账号缓存，
不要提交。

## 约定

- 每个 spec 用独立用户名前缀；跨 spec 只读共享数据（赛事列表、审计）不断言绝对数量。
- 需要钱/道具时走 `fund()`（DB 直写，见 `apps/api/src/scripts/e2e-seed.ts` 文件头背景）。
- 需要开赛时先 `backdateTournament()` 回拨时间窗，再调管理员 start 接口。
- UI 优先用 `data-testid` 定位；分支随机处（历练选项、讲课强接）用"枚举+断言合法分支"模式，
  不赌随机结果。
