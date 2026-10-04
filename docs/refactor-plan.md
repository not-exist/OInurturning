# OInurturning 重构方案（修订版）

> 状态：待评审
> 基线：`origin/main` @ `1035b33`（PR #63 已合入，`6dcb7bd`）
> 本文所有计数均为实测，命令与证据随行标注；被证伪的草案结论见 §附A。

## 0. 硬性约束

| # | 约束 | 缘由 |
|---|---|---|
| 0.1 | **任何"删除/合并"提案，先 `git log -S <符号>` 并读周围注释**；注释含 `F-x` / 审查 / 里程碑编号者视为有意设计，只能在 PR 里带反证推翻 | 草案有三处把刻意设计读成冗余（§附A），其中两处回退后会立即产生缺陷 |
| 0.2 | 优化必须可测：**>10% 的 CPU/内存/存储/耗时改善，或行数净减且复杂度不升**；5ms 内视为噪声 | 性能是主要评估项；草案用它从未测量过的估算给阶段排序 |
| 0.3 | 每阶段一个 commit，产物完整可编译，可独立回滚；**不 push**，全部完成后统一 push | 便于 reviewer 分阶段审查 |
| 0.4 | 不碰：`apps/api/src/modules/contest/engine/{duel,solve,ranking}.ts` 的算法、`docs/data/*.yaml` 的任何数值、已应用的 20 个迁移 | 有 `report-determinism` / `m2-golden` / `contest-rng-replay` 三层 golden 快照与 `bal:regress` 数值门保护 |
| 0.5 | 删除要删干净，不留兼容分支 | 项目既有规则 |
| 0.6 | 提交信息遵循 §5：**原子化、全英文、`type(scope): subject`** | 孤儿化后 history 是仓库的新门面，而旧的"为什么"记录已不可恢复（§1.4 R2） |

## 1. 仓库变动方式：Orphan Branch 全量重构

### 1.1 采用的前提

- 能接受历史重写；旧历史可丢弃；已通知团队。

### 1.2 步骤

```bash
# 1. 创建孤立分支
git checkout --orphan refactor/v2

# 2. 旧代码压成 baseline
git add -A && git commit -m "chore: import legacy codebase as baseline"

# 3. 原子化重构，逐个提交
#    提交信息遵循 §5：type(scope): subject（全英文、≤72 字符、正文写为什么）
git commit -m "refactor(api): ..."
git commit -m "refactor(shared): ..."
git commit -m "test(api): ..."
git commit -m "chore: remove legacy files"

# 4. 推送开 PR
git push origin refactor/v2

# 5. 重命名：让 refactor/v2 变成 main
git branch -m refactor/v2 main        # 本地重命名（旧 main 需先改名或删除）
git push origin main --force-with-lease    # 覆盖远程 main（用 lease 而非裸 --force，见 R5）
git push origin --delete refactor/v2  # 删除远程旧分支名
```

> 若本地已有 main，先 `git branch -m main old-main`，再 `git branch -m refactor/v2 main`。每条提交的 message 生成规范见 §5，可执行的格式校验命令见 §5.4。

### 1.3 最终形态

每条提交的 message 遵循 §5（此处 xxx 是占位）：

```
main
 ├── chore: import legacy codebase as baseline
 ├── refactor(api): ...
 ├── refactor(shared): ...
 ├── test(api): ...
 └── chore: remove legacy files
```

### 1.4 本仓库适配与风险（实测）

| # | 项 | 实测事实 | 处理 |
|---|---|---|---|
| R1 | **`git add -A` 会把未跟踪垃圾压进 baseline** | `git status --porcelain` = `?? .codebuddy/`（编辑器配置）+ `?? history.txt`（96,783 字节的会话日志），**二者都不在 `.gitignore` 里** | 先补 `.gitignore`，或用 `git add -A -- ':!history.txt' ':!.codebuddy'`；否则 baseline 提交就带着它们 |
| R2 | **历史即证据，孤儿化会销毁它** | 本方案 §附A 的多处结论**全部**来自 `git log -S "reconcileTables"` / `-S "F-1/F-2"` 与会话内的注释比对；孤儿分支后"这段代码是有意的"这条链路永久消失 | 硬性前置：**语义审计必须在孤儿化之前完成**；建议把 §附A 作为早期 commit 保留 |
| R3 | **打开的分支会失去 merge-base** | 远端现有 5 个非 main 分支：`UI-refactor`、`fix-guide`、`fix-test`、`dependabot/npm_and_yarn/dotenv-18.0.0`、`dependabot/.../minor-and-patch-*`（2 个） | 重写 main 前逐个处置（合入或关闭重开）；否则它们的 PR 全部变成不可合并 |
| R4 | **`--force` 会被分支保护拒绝** | 工作区无法判定服务端规则 | 先在 Settings → Rules 确认 main 是否受保护，必要时临时放开，再恢复 |
| R5 | **`--force` 应改为 `--force-with-lease`** | 裸 `--force` 会覆盖掉你 fetch 之后别人推到 main 的提交 | `git push origin main --force-with-lease=main:<旧 sha>` |
| R6 | **其余人的克隆无法 `git pull`** | 孤儿历史与旧 main 无共同祖先 | 通知团队改为 `git fetch && git reset --hard origin/main` 或重新 clone；同时 `git remote set-head origin -a` |
| R7 | tag / release 迁移成本 | `git tag` 实测为 **0** | 无成本 |
| R8 | 本地分支清理 | 现有 `refactor`（本次评估用）、`fix-guide`、`fix-test`、`UI-refactor`、`feat/team-battles`、`main` | 孤儿化后统一清理，避免误推 |

### 1.5 与阶段计划的关系

孤儿分支是**载体**，§2 是**内容**。建议顺序：先按 §附A 完成语义审计（规避 R2）→ 建 `refactor/v2` 并压 baseline（含 R1 修正）→ 按 §2 逐阶段原子提交 → §3 门禁全绿后才执行第 5 步重命名。

## 2. 阶段计划

排序原则：先零风险清理 → 再测量 → 再做可测收益的性能项 → 再做结构收口 → 最后建防护网。**按模块纵向切分**（一个模块内把死代码、import、helper 一次做完），不做横向"主题阶段"——草案的 P0/P1/P2 都动 `apps/api/src` 同一批文件，"无文件交集可并行"不成立。

### R0 文档与 CI 噪声清理（零风险，先做）

**文档（全部实测矛盾）**

| 位置 | 问题 | 证据 |
|---|---|---|
| `README.md:194` | 称"管理员可通过 `POST /api/admin/config/reload` 热重载"，该端点不存在 | `admin/router.ts` 仅 10 条路由；`docs/TECH-DESIGN.md:988` 与 `:1161` 均标注**未实现** |
| `README.md:192` | yaml 清单列 6 个，实际 8 个（漏 `tutorial.yaml`、`shop.yaml`） | `apps/api/src/config/loader.ts:34-43` 的 `FILES` |
| `README.md:80` | "本地 MySQL 8.4 / MariaDB" | compose 实为 `mysql:26.7` |
| `README.md:30,78` | "Node.js 22+ / >= 22" | CI 与两个 Dockerfile 均为 node 26 |
| `.github/dependabot.yml` 注释 | 仍写 "mysql:8.4" | 两个 compose 已是 26.7 —— 这条**过期注释本身就是"dependabot 只 bump compose、碰不到 workflow `services:` 镜像"的物证**，建议写进 PR 描述 |

**CI**

- 删 `test.yml` 的 17 个 `locate-*`、`Attribute typecheck errors`（`:47-61`）与 `Emit test diagnostics`（`:72-104`）：全部带 `if: failure()`，只给已失败的 job 换个红叉名字；`--reporter=github-actions`（`:67`/`:71`）已提供原生注解。纯归因脚手架合计 **84 行**（`:47-61` + `:72-104` + `:105-107` + 17 个 locate）。
- **修一个真实缺口**：`Cleanup test logs`（`:106`，`if: always()`）在上传步骤**之前**就 `rm -f unit-test.log integration-test.log`，而上传步骤（`:159-167`）只传 `typecheck.log` / `typecheck-attrib.log` → **真正的测试失败日志从未被上传**。把清理移到上传之后，并把两个测试日志纳入上传。
- 删 `e2e.yml` 的 boot-capture 块（`:59-80`，22 行）。10 个 `locate-*` 可删，但注意它们是**正向断言**（`grep -q 'JSTAGE:x' journey.log || exit 1`），编码"旅程走到哪一步"——重写为在 `journey-full.e2e.test.ts` 内断言，不要直接丢信号。
- 修 artifact 路径缺陷：`e2e.yml:122` 上传的 `/tmp/api-poll.log` **全仓无人创建**（被写的是 `/tmp/dual-poll.log`）；所有上传步骤补 `if-no-files-found: ignore`。
- 两个 workflow 加 `concurrency: { group: "<workflow>-<ref>", cancel-in-progress: true }`；`on: push` 加 `branches: [main]`（当前无过滤 + `pull_request`，同仓分支开 PR 时每个提交跑两遍完整 CI）。
- 两个 workflow 的 `services.mysql`（各 14 行）与 setup 块（各 9 行）**逐字节相同**，抽成 composite action 或 `workflow_call`。
- `tests/e2e/playwright.config.ts:23` `retries: 0` → CI 下建议 2（`:31`/`:32` 的 trace/screenshot 已足够诊断，无需保留 boot-capture）。

**死代码（已核验为零引用）**：`getTestApp`、`resetUsersFast`、`createTestUserDirect`、`uniqueUsername`（`tests/helpers.ts`）、`apiErrorDetails`、`itemIsLit`、`TIER_BORDER`、`useUpdateTournamentPrizes`、`useStoryProgress`、`labels.ts` 的 `itemEffectKindLabel`/`acquiredViaLabel`/`REQUIREMENT_LABEL`/`hookLabel`/`hookValueLabel`（连带 5 个只被它们引用的私有常量）、`EVENT_RARITIES`、`normalizeConfigDimension`、`ContestReportView`、`Credentials`、`HookCondition`、`AttemptVerdict`、`QuestionVerdict`、`economy/progression.ts:212` 的三名再导出、`tests/global-setup.ts:90` 的 `teardown`、`config/env.ts:6` 的 `env.PORT`（全仓零读取）。

> **不要删** `rejectJsonSafetyIssue`（`shared/domain/contest.ts:14`）：草案列为死代码，实测被 `rejectNonJsonSafeValues` 调用 **12 次**，删了直接编译失败。
> 全仓"仅出现在定义行"的导出实测 **48** 个（草案称 43），删除前用 word-boundary grep 复核；注意 `tests/e2e/fixtures.ts` 与 `tests/helpers.ts` 存在同名函数（草案的 `unwrap` 假阳性即此因）。

### R1 配置导入性能（先测量，再改）

**先测**：`importConfigs()` 单次耗时（fixture 源 / `docs/data` 源分别测）、CI 各步骤耗时。若集成测试步骤占比 <10%，本项降级。

**改法（保留语义）**：`reconcileTables` 实测 **250 次串行 upsert**（talents 61 + items 81 + problems 34 + stages 33 + events 40 + economy 1）+ 5 次 `updateMany`，改为 `tx.$transaction([...])` 数组形式或 `createMany({ skipDuplicates }) + updateMany`；6 个循环体除表名外完全同构，可参数化为 `(delegate, items, idOf)` 表。

> **不要"hash 命中就跳过 reconcile"**（草案头号建议）。`loader.ts:209-213` 注释写明"完整导入与幂等跳过两条路径共用（F-1/F-2）"，`git log -S "reconcileTables"` → `d85836b fix(api): 幂等跳过路径调和 DB 回滚不一致 …（M1 Task 1 审查 F-1/F-2/F-3）`。这是 review 驱动的自愈修复，删掉即回归。且机制上无效：`importConfigs()` 实测 **86 个调用点 / 30 个文件**（`config-import.test.ts` 一个文件 22 处），大量调用传 `configDir` 指向 fixture → **不走 hash 分支**。

**验收**：耗时下降 >10%（给出数字）；`config-import.test.ts`、`config-m2-*` 全绿；可顺带把 `testTimeout: 15_000` / `hookTimeout: 20_000` / `--max-old-space-size=4096` 回调为回归护栏。

### R2 报告 schema 瘦身（真实热路径）

- 每次比赛结算都会整树 `parse` 报告：`contest/engine/duel.ts:366`（`duelReportSchema.parse`）、`contest/engine/report.ts:105`（`validateRankingReport` → `rankingReportSchema.parse`）。其中 **24 个 shape 各套一层 `withJsonSafety`** 的 `z.preprocess` 递归 walker（`rejectNonJsonSafeValues` 112 行），同一子树按深度被重复遍历。
- 改法：删 24 个 wrapper 与 walker，改为在**写入侧**做一次 `toJson()` 断言（`contest/repository.ts:102`，并盘点 `schema.prisma` 的 26 个 Json 列的其它写入点）。注意当前 JSON 安全校验只挂在读取/报告 schema 上，**真正该有校验的是写入侧**。
- `serializeRankingReport`（`report.ts:108`）重复 parse —— 该函数**生产零调用**（仅 `report-determinism.test.ts` 3 处），顺手清理即可，不计入收益。
- **验收**：单场 duel / ranking 结算耗时下降 >10%；`report-determinism` + `m2-golden` + `contest-rng-replay` **逐字节不变**。

### R3 依赖与过时 API 的正确收尾

**Prisma generator**

- `schema.prisma:1-3` 仍是 `provider = "prisma-client-js"`。已安装的 prisma@7.10.0 CLI 把二者描述为 `"Prisma Client generator"` vs **`"Legacy Prisma Client JS generator"`** → 迁到 `prisma-client` 的方向成立。（草案"官方明确废弃、将移除"的措辞**本地无法取证**，属过度陈述。）
- 选项已存在：`moduleFormat` / `importFileExtension` / `generatedFileExtension` 均在 7.10.0 CLI 中；`output` 为 v7 必填。
- 波及面：`from '@prisma/client'` 共 **30 个站点**（26 src + 4 tests）；`.gitignore` 加 `apps/api/src/generated/`。
- **`@prisma/client` 能否从 dependencies 移除，必须先跑一次真实 `prisma generate` 验证**：已安装的 `@prisma/client@7.10.0` 仍导出 `./runtime/client`（含 mysql query-compiler wasm）并自身依赖 `@prisma/client-runtime-utils@7.10.0`。不得按草案直接删。
- 草案"tsup 的 `noExternal` 需加 generated 路径"是**错的**：`noExternal` 只作用于裸包名，`../generated/prisma/client.js` 是相对导入，esbuild 无条件打包。
- 顺带验证：若 Rust-free generator 使占位引擎不再需要，可删 `scripts/dev-bootstrap.mjs` 的**第 1 步**（占位 Prisma 引擎绕过 CDN 下载）+ `README.md:95-103` 的"离线自举"章节 + `pnpm bootstrap:offline`。这可能比上面任何一条都值钱（262 行脚本 + 文档 + 环境特判）。
- 版本策略：`prisma` 是 `^7.10.0`，而 `@prisma/client` 与 `@prisma/adapter-mariadb` 是**精确 `7.10.0`** → minor-and-patch 组会单独抬 CLI，产生 CLI/客户端漂移。统一策略（catalog 或统一精确版本）。

**zod（草案数字不成立）**

到 `node_modules/.pnpm/zod@4.6.5/.../v4/classic/*.d.ts` 逐项取证：

| API | 站点 | 状态 | 替代 |
|---|---|---|---|
| `.strict()` | 81 | **未废弃**（`schemas.d.ts:498` 仅 `Consider z.strictObject(A.shape) instead`） | 不动 |
| `.passthrough()` | 23 | 已废弃 `schemas.d.ts:494` | `z.looseObject()` / `.loose()` |
| `.addIssue()` | 45 | 已废弃 `errors.d.ts:13` | push 到 `.issues` |
| `z.ZodIssueCode.custom` | 45 | 已废弃 `compat.d.ts:9` | 裸字符串 `'custom'`（与上一行同址，去重） |
| `.flatten()` | 24 | 已废弃 `errors.d.ts:7` | `z.treeifyError`（`z.flattenError` 亦存在，`core/errors.d.ts:157`） |
| `z.ZodTypeAny` | 2 | 已废弃 `compat.d.ts:38` | `z.ZodType` |
| `.url()` | 1 | 已废弃 `schemas.d.ts:115` | `z.url()` |
| `.datetime()` | 1 | 已废弃 `schemas.d.ts:163` | `z.iso.datetime()` |

真正废弃的是 **96 条语句**（按出现次数 141），草案称 181、其表格相加 222 —— 均不可复现；草案最大的那一块（81 处 `.strict()`）根本不是废弃 API，属**无收益的风格迁移**。按 §0.2，这部分不做独立阶段，合并进必定要改的文件时顺手处理。分布修正：`.passthrough()` 有 3 处在 `shared/config/shop.ts`、1 处在 `tutorial.ts`、1 处在 `apps/api/src/modules/items/effects.ts`。

**dotenv**：仅 2 处 `import 'dotenv/config'`（`config/env.ts:1`、`prisma.config.ts:4`），且在 dependencies。删除后需同时处理 **`prisma migrate deploy` / `generate` 的 env 通路**（`apps/api/package.json` 的 `migrate`/`generate` 脚本），不只是草案说的 `dev` 脚本；测试侧不受影响（`tests/setup.ts:9-10` 用 `||=` 提供，unit 配置另有 `env:` 块）。

**typescript**：`^6.0.3` 出现在 4 个 package.json；typescript-eslint 8.70.x 的 peer 上界实测为 `>=4.8.4 <6.1.0` → 收紧为 `~6.0.3` 并在 dependabot 对 typescript 忽略 minor/major。（草案此条正确，保留。）

### R4 重复收口（按模块纵向切）

| 项 | 实测 | 注意 |
|---|---|---|
| `clamp` | 命名 helper **12** 份 + 无名内联 **38** 处 / 21 文件 | `tutorial/routing.ts:82` 带 `Math.trunc`，必须拆成 `clampInt` 并单测 |
| 加权抽取 | **6** 份（两份同名 `weightedPick` 的错误类型不同：`extractor.ts` 抛裸 `Error`→500，`service.ts` 抛 `ApiError`→409，是真实行为分叉） | 合并时先判定哪个语义正确 |
| `FOR UPDATE` | 字样 29（注释 5）→ **25 处真实站点 / 13 模块**；22 单行 + 3 批量 | **其中 12 处是完全相同的 `SELECT id FROM users … FOR UPDATE`（48%）**，是 helper 的首选收益点；批量形态参数名不统一（`ids` vs `lockedIds`） |
| 表名口径 | `@@map` 仅 1 处（`users`）；行锁里 `users` 12 / `Student` 7 / `PvpTournament` 4 / `RecruitPool` 1 / `AdventureLog` 1 | 风险面是 **4 个模型 13 条语句**，不是 27 个模型；先落 `lockXxx(tx, …)` 常量表再谈改名 |
| Json 写入助手 | **11** 份定义，其中裸 cast **5** 处（`loader.ts:160`、`admin/service.ts:57`、`contest/repository.ts:46/50`、`pvp/registration.ts:50`、`pvp/rewards.ts:154`） | 而 `shared` 为同一件事写了 112 行递归 walker —— 两端严格程度不一致 |
| `requireConfig` 守卫 | **17** 处 / 14 文件，含 5 个同名私有副本 | 可收成一份 |
| `readYaml` | 4 处同模板 + 1 处（`tests/tutorial-shop.test.ts:23`）**无 errors 检查** | 不是 5 份同构 |
| `Array.isArray(badges)` | **6** 处 | 写回侧缺元素级校验（`story/service.ts:550` 读侧有） |
| 六维/能力键 | **28** 处声明/映射；`STRING`/`string`/`str` 三拼写并存，`CODING`/`coding`/`code`、`PROBLEM`/`setting` 双轨 | 无单一真源；Prisma 列名一律 `str`/`code`/`setting` |
| Student→ParticipantSnapshot | abilities 块 3 份**逐字相同**；但 traits 段已分叉（`adventure` 用 `?? []` 静默空数组，另两处会抛 TypeError） | 合并时必须选一个语义 |
| `rowToProgress` / `toProgressView` | **不是逐字相同**：4 处差异（story 版多 `undefined` 分支、用裸 cast 而非 `jsonValue`） | **已漂移的复制比重名复制更危险**，合并前逐分支确认语义 |
| 阻尼公式 `(1 - cur/100)^2` | 3 份等价 | `training/gains.ts`、`economy/progression.ts`、`story/service.ts` |
| FNV-1a / Box-Muller | 各 2 份，算法一致（FNV 常量与顺序逐位相同） | 归入 `contest/engine/rng.ts` |
| 稀有度序 | 真副本 **3** 份（`shop/service.ts:127`、`scripts/recruit-stats.ts:47`、`scripts/balance-regression.ts:180`）；`config/semantic.ts` 与 `recruit-gen.ts` **已**用共享 `CONFIG_RARITIES`，不应列为待收敛 | 大小写双轨真源：`talents.ts:7` 小写 `colorful` vs `enums.ts:2` 大写 `RAINBOW` |
| 状态枚举 | Prisma 10 个 enum 的"第二份声明"**不在 `shared/enums.ts`**（该文件只有 `RARITIES`/`DIMENSIONS`/`ABILITY_KEYS`），而是手抄散落在 5 个文件；`AdventureStatus` 等 2 个**根本没有第二份** | `TrainingKind`/`QualityTier` 大小写双轨，靠两张手写表往返翻译 |
| 引擎不变量 | `isBetterTeamAttempt`、`aggregateTeam`、排序口径在 shared 与 engine **逐字两份** | 抽离成立，但**不是单文件搬迁**：需整体搬 `engine/`（6 文件）+ `mulberry32`，因 shared 不能 import apps/api |

### R5 跨端契约（先 diff，再搬）

- 先做**逐字段 diff**，产出三类计数（真重复 / 有差异 / 无对应）。草案的"38 个重复视图类型"是 `hooks.ts` 的 interface 总数，它自己只列出 17 个同名者 —— 不要沿用 38。
- 现状是"**半途而废的迁移**"而非从未开始：`ContestRecordView` 已在 `shared/domain/contest.ts`，`contest/repository.ts:11` 从 shared 引它；`shared` 也已有 `/enums`、`/item-usage` 子路径先例（`item-usage.ts:4-8` 注释解释了为何必须避开 zod barrel，实测 +82KB）。新增子路径需同步 `packages/shared/package.json` 的 `exports`。
- **验收标准要改**：草案写"改 API 字段名 → web `tsc` 报错"是**同义反复**——`@oinur/shared` 以 TS 源码被消费（`exports: "./src/index.ts"`，无 build、无 `paths`），两边引同一声明必然一致。应改为"**改 shared 里的字段 → API 侧 `tsc` 报错**"，以证明 service 的返回类型确实绑在 shared 上（该链接今天已存在，如 `items/service.ts:35`）。
- 因此本阶段的真实收益是"**少约 400 行重复声明**"，不是"新增一层检查"——按此重排优先级。

### R6 防护网（最后；先 `warn` 后 `error`）

- `eslint.config.mjs` 实测 17 行、仅 `tseslint.configs.recommended`（非 type-checked）+ 1 条禁 `$queryRawUnsafe`；无 `ignores`、无分域、**web 侧无 react-hooks 规则**（`eslint-plugin-react-hooks` 在 lockfile 中 0 命中 → 需**新增依赖**）。
- `prettier --check` 先单独一个纯格式化 commit 再进门禁（`.prettierrc` printWidth 100）。
- 架构测试：web 不得 `export interface *View`；`clamp`/`weightedPick`/`FOR UPDATE` 定义数 == 1；Prisma enum 与 shared 联合类型一致。
- **linter 目前覆盖不到**：`tests/e2e`（仅 `e2e:typecheck` 独立脚本，**不在 `pnpm -r typecheck` 内**）、`scripts/*.mjs`。

### R0.5 / R7（本次新增）

- **R0.5 统一测试配置源**（优先级高于任何行长优化）。`apps/api/src/index.ts:181-185` 把 `apps/api/tests/fixtures/config`（**790 行**）设为整个测试套件的默认 `CONFIG_DIR`，而 `docs/data` 是 **4,852 行**：fixtures 里 talents 3 条（真 61）、items 34（真 81）、problems 2 个模板（真 34）、events 1 条（真 40）。同时有 **14 处无参 `importConfigs()`** 会退回 `env.CONFIG_DIR`（默认 `docs/data`），使同一文件内 `CONFIG` 在两个数据源间翻转。→ 大部分配置驱动行为其实只验证了缩水副本；应先明确每个测试用哪一份并消除翻转。
- **R7 疑似产品漏项：已开 issue 跟进，不在本重构 PR 里改。** 核查见下：[#65](https://github.com/not-exist/OInurturning/issues/65) —— `growthDeltaShape.attr` 白名单只到 10 键、缺 `setting`，而 `ABILITY_KEYS` 含 `PROBLEM`、Prisma `Student` 有 `setting` 列；若为漏项则"出题能力"无法通过成长增量落地。是否修复由该 issue 决定，避免与重构混在一个 PR。

## 3. 门禁与 KPI

| 阶段 | 必绿 |
|---|---|
| R0 / R0.5 | `pnpm -r typecheck && pnpm -r lint && pnpm -r build && pnpm test && pnpm e2e:typecheck && pnpm e2e`；CI 时长下降 |
| R1 | 同上 + `importConfigs()` 耗时前后对比（>10%，分两个配置源） |
| R2 | 同上 + `report-determinism` / `m2-golden` / `contest-rng-replay` **逐字节不变** + 结算耗时对比 |
| R3 | 同上 + 完整 `migrate deploy` + `e2e:seed` + 镜像体积对比；zod 按文件分批跑 `test:unit` |
| R4 | 同上 + `clampInt` 单测 |
| R5 | 同上 + "改 shared 字段 → API 侧 `tsc` 报错"的实测记录 |
| R6 | 新规则先 `warn` 跑一轮清零，再改 `error` |
| 每个提交 | 提交信息匹配 §5 的 `type(scope): subject`（校验命令见 §5.4，应为空输出） |
| 全程 | `pnpm bal:regress` 与 `pnpm sim:economy` 必须始终 PASS |

**KPI 写法**：每阶段给出"**净删除行数 + 一个可测指标**"。不要用"总行数 −10%"——仓库全部跟踪文本实测 **57,895 行**，草案表格各行为 50,414 行（口径不一：web/e2e 只数 `.ts`，api/tests 连 fixture yaml 一起数），而它自己各阶段净删除相加仅约 4,300 行，推不出 −5,661 行。

## 4. 明确不做的事

- 不重写 `contest/engine/` 的算法（三层 golden 快照 + 确定性要求）。
- 不改 `docs/data/*.yaml` 的数值（`balance-regression` 有完整数值门）。
- 不 squash 已有的 20 个迁移（含 `20260911000000_user_deleted_at` → `20260913000000_hard_delete_users` 的往返；已应用的历史不可改写）。
- 不引入新框架（Express 5 + Prisma 7 + zod 4 是当前正确选择；问题是没用它们的新范式）。
- 不重复 PR #63 已做的（幂等键、auth 单查询、deploy 去重）。注意 `index.ts:113-150` 的"整个请求只做一次 user-PK 查询"是**有意设计**，不是冗余。
- 不在 `/admin` 下为假想用户加辅助功能。

## 5. Commit 规范

### 5.1 规则

1. **原子化**：一次提交只做一件事；每个提交必须能独立编译、并通过该模块的测试（§2 阶段计划里的每一步 = 一个提交）。不把"顺手清理"混进功能改动。
2. **全英文**：type / scope / subject 与正文一律英文。
   > 现状说明：最近 200 条非合并提交中有 **76 条含中文**，因此本规范是**孤儿化之后生效的新约定**，不是对现状的记录。
3. **标题简洁**：形式为 `type(scope): subject`；subject ≤ **72 字符**（历史最长 100，其中两条正好 100）、祈使句、首字母小写、结尾不加句号。
4. **正文写"为什么"**：非显然的改动必须写正文。孤儿化会丢弃旧历史，**新提交的正文是唯一的"为什么"记录**（§1.4 R2）；破坏性改动加 `BREAKING CHANGE:` 脚注。
5. **保持线性历史**：PR 用 squash 合并，不使用 merge commit（旧历史里有 19 个 `Merge pull request` 噪音，§1.3 的最终形态是一条直线）。

### 5.2 允许的 type 与 scope

- **type**：`feat` / `fix` / `refactor` / `perf` / `test` / `docs` / `build` / `chore` / `revert`
- **scope** 用模块名，取仓库实测的高频值：`web` `api` `shared` `contest` `tutorial` `pvp` `story` `adventure` `items` `shop` `config` `balance` `e2e` `ci` `deploy` `deps`
- **不要用里程碑代号做 scope**（历史里出现过 `m5`；测试文件名里的 `m2` 同理，见 §2 R6）
- **dependabot 的提交不受本规范约束**（`build(deps): bump …` 原样保留）

### 5.3 示例

反面 → 正面（前三条改自真实历史）：

| 现状 | 改为 |
|---|---|
| `fix(api): 幂等跳过路径调和 DB 回滚不一致 + CONFIG 深冻结（M1 Task 1 审查 F-1/F-2/F-3）` | `fix(config): reconcile config tables on the idempotent import path`，F-1/F-2 的来由放正文 |
| `feat: 讲课附带出题/思维成长（issue #56）` | `feat(academy): grant problem-setting and thinking growth on lecture`，issue 号放正文 |
| `docs: 重写 README 为项目介绍，补全 AGPL-3.0 完整协议文本，优化测试脚本` | 拆成多条：`docs: rewrite README as a project introduction` + `chore: add the full AGPL-3.0 license text` |
| `refactor(items): 取消鸡腿便当「每名学员每日限用 1 份」限额` | `refactor(items): drop the daily use limit on drumstick-bento` |

§2 阶段计划对应的提交序列：

```
chore: import legacy codebase as baseline
docs: fix README and CI drift found in the plan audit
fix(ci): upload test logs before cleanup and drop locate-* scaffolding
perf(api): batch the config reconcile upserts
perf(contest): drop the recursive JSON-safety walker from report schemas
build(api): migrate to the prisma-client generator
refactor(shared): migrate the 96 deprecated zod call sites
refactor(api): extract lock/clamp/weightedPick helpers
refactor(shared): move response view types out of the web hooks
chore: remove legacy files
```

### 5.4 校验

```bash
# 单条
git log --pretty=%s -1 | grep -qE '^(feat|fix|refactor|perf|test|docs|build|chore|revert)(\([a-z0-9./-]+\))?!?: .{1,72}$'

# 整条分支（期望：空输出）
git log --no-merges --pretty=%s origin/main..HEAD \
  | grep -vE '^(feat|fix|refactor|perf|test|docs|build|chore|revert)(\([a-z0-9./-]+\))?!?: '
```

当前仓库**没有** commitlint / husky / `.githooks`（实测均不存在），因此上面两条先作为 §3 门禁的一部分手跑；是否上工具化另议。

## 附A：草案被证伪的结论（保留备查）

| # | 草案结论 | 实测 | 证据 |
|---|---|---|---|
| A1 | "hash 命中跳过 `reconcileTables`"是头号优化 | **回退了 `d85836b` 的审查修复**（F-1/F-2：幂等跳过路径调和 DB 回滚不一致）；且 fixture 调用不走 hash 分支，省不到主要成本 | `loader.ts:209-213` 注释 + `git log -S` |
| A2 | zod 有 "181 处已废弃 API" | **96 条**（141 次出现）；`.strict()` 81 处**未废弃** | `zod@4.6.5/v4/classic/*.d.ts` |
| A3 | `prisma-client-js` "官方明确废弃、将移除" | CLI 仅标注 **"Legacy"**，无 deprecated 措辞 → 措辞应降级 | `prisma@7.10.0/build/cli.js` |
| A4 | "`@prisma/client` 可从 dependencies 移除" | **未证实且有风险**（仍导出 `./runtime/client`）→ 需真实 generate 验证 | `@prisma/client/package.json` exports |
| A5 | "`noExternal` 需加 generated 路径" | **错**：相对导入 esbuild 无条件打包 | — |
| A6 | `rejectJsonSafetyIssue` 是死代码（P0 可删） | **被调用 12 次**，删了编译失败 | `grep -c` |
| A7 | `requireAuth` 的 35 行解析体是死代码 | **每个未认证请求都执行**，且是 `TOKEN_EXPIRED` 唯一产出点；PR #63 的单查询设计被误读 | `index.ts:113-150` 注释原文 |
| A8 | `listProblemLibrary` 是零调用空壳 | 有真实路由调用者 | `problems/library-router.ts:34`（`index.ts:159` 挂载） |
| A9 | `unwrap` 零引用 | 被 `health.test.ts` 用 2 次（与 `tests/e2e/fixtures.ts` 同名函数混淆） | `grep` |
| A10 | "63 个 try/catch 与 63 个 `res.json` 严格 1:1" | **60 对 60**（55 个 `res.json` + 5 个 `res.status().json`） | `grep -c` |
| A11 | `parseId` 4 处在 students/items/training/academy | 实际在 **adventure / problems-library / pvp / students** | `grep "function parseId"` |
| A12 | "10 个 enum 在 Prisma 与 `shared/enums.ts` 各声明一遍" | `shared/enums.ts` **一个都没声明**（只有 `RARITIES`/`DIMENSIONS`/`ABILITY_KEYS`）；手抄散落 5 文件 | `cat shared/src/enums.ts` |
| A13 | `memberIdentityKey`/`teamIdentityKey` "字段顺序敏感" | **不敏感**：stringify 的是显式数组字面量 | `contest.ts:539-561` |
| A14 | `deleteMany` 15 个 / `withJsonSafety` 22 个 / `dailyUsed` 被 4 处调用 / 测试前导含 `prisma.$disconnect` | 实测 **18 / 24 / 3 / 0**（测试链路里根本没有 disconnect） | `grep` |
| A15 | 测试失败日志"已在 artifact 里" | **上传前就被 `rm -f` 删掉了**，只传 typecheck 两类 | `test.yml:106` vs `:159` |

## 附B：方法与边界

- 本方案的计数来自两轮只读核验：主会话逐条实测 + 7 个并行只读核验（按域分工：数值/结构重复、跨端契约、过时 API、死代码、CI 基础设施、配置加载器与测试、大文件）。
- 未运行 install / build / test / prisma / docker：**R1/R2/R3 的收益数字尚不存在**，这正是 §0.2 要求先测量的原因。
- 依赖审计前需先 `pnpm install --frozen-lockfile`（当前 `node_modules` 落后于 lockfile `@1035b33`，8 个 bump 有 7 个未落盘）。
