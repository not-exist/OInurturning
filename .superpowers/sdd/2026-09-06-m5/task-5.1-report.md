# T5.1 收支模拟交接报告

日期：2026-09-07  
分支：`m2-contest-story`

## 结果

T5.1 已实现无数据库、无随机数的 YAML 驱动周经济模拟。真实数据输出固定为 `beginner`、`mid`、`late`，只有 `mid` 参与 YAML 声明的目标 gate。

| 画像 | 收入 | 支出 | 净额 | 收入/支出比 |
|---|---:|---:|---:|---:|
| beginner | 1120 | 1469 | -349 | 0.7624 |
| mid | 3990 | 3804 | 186 | 1.0489 |
| late | 66775 | 9299 | 57476 | 7.1809 |

目标：`mid`，区间 `[0.90, 1.15]`，实际 `1.0488958990536277`，结果 `PASS`。

## TDD 证据

- RED（配置）：新增画像测试首先因 `economy.yaml` 没有 `simulation` 且 shared schema 无对应字段失败。
- GREEN（配置）：配置/schema/semantic focused tests 12/12 通过。
- RED（引擎）：测试收集因 `src/modules/economy/simulation.ts` 不存在失败。
- GREEN（引擎）：训练、书籍、招募、课程、历练、剧情、被动收入、零支出、排序与错误配置测试通过。
- RED（CLI）：测试收集因 `src/scripts/sim-economy.ts` 不存在失败。
- GREEN（CLI）：文本、JSON、YAML 路径、失败 gate 和 root command 边界测试通过。
- 质量门 RED：首次完整 API 测试因本地 generated Prisma client 早于 M4 `PvpRewardGrant` schema 而失败 10 项；`pnpm -C apps/api generate` 后 PVP focused 13/13 通过，最终 API 全量 319/319 通过。
- lint RED：新增 engine/test 有 38 个 `no-explicit-any`；改为 shared schema 类型和窄化接口后 focused lint、typecheck 与模拟测试通过。
- 配置完整性 RED：删除 `passive` 分区时引擎曾静默丢失固定收入行；改为路径明确的配置错误后，模拟测试最终 30/30 通过。
- 公式 RED：赞助收入测试暴露实现误用 14 天合约期作为周窗口（2660）；改为固定 7 天周窗口后，late 赞助收入为 1330。

## 实现文件

- `packages/shared/src/config/economy.ts`：simulation schema 与导出类型。
- `docs/data/economy.yaml`：三画像输入及生成结果同步。
- `apps/api/src/config/semantic.ts`：跨文件引用检查。
- `apps/api/src/modules/economy/simulation.ts`：确定性纯函数内核。
- `apps/api/src/scripts/sim-economy.ts`、`scripts/sim-economy.ts`：YAML 加载、报告与 root CLI。
- `apps/api/tests/economy-simulation.test.ts`：结构、公式、CLI 与真实 YAML gate 回归。

## 质量门

- `pnpm --silent sim:economy -- --json`：退出 0，mid gate PASS。
- `pnpm -C apps/api exec vitest run --no-file-parallelism`：36 files / 319 tests 通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过（API tsup + Web Vite production build）。
- `git diff --check`：通过。

## 验收边界

Docker compose、浏览器与视觉人工验收按用户约定延后到 M5 最终部署窗口；T5.1 本身不启动服务、不连接数据库、不进行浏览器操作。
