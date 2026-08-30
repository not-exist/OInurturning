# M1 学员·背包·训练 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M0 骨架上实现培养主循环的核心三件套：配置即数据管线（talents/items/economy 入 Config 表）、学员全生命周期（招募→管理→养成道具→训练）、懒结算资源时钟。验收＝「注册→招募→训练→用书→体力随现实时间恢复」全链路可用。

**Architecture:** 沿用 M0 的 pnpm monorepo。API 新增模块：`config`（启动导入管线）、`academy`（招募）、`students`（管理/训练）、`items`（背包）。领域规则权威文档：`docs/systems/student.md`（属性/招募分布/训练公式/道具效果/开除）、`docs/systems/gameplay.md`（学院流程）、`docs/data/economy.yaml`（一切钱数值）、`docs/data/talents.yaml` / `items.yaml`（配置数据）。数值禁止硬编码进代码——一律读内存 CONFIG 缓存。

**Tech Stack:** 同 M0（Express 5 + Prisma 6 + zod + Vitest + supertest；React 19 + RR7 + zustand + react-query + Tailwind 4）。新增：yaml 解析（`yaml` 包）、mulberry32 种子随机（自实现，~10 行）。

---

## 全局约束（每个任务派发时复述）

- 分支 `m1-students`；禁 docker；MariaDB @127.0.0.1:3306（oinur/oinur，库 oinur/oinur_test，shadow 权限已授可 migrate dev）
- strict+NodeNext；ESM 相对导入带 `.js`；web 侧 bundler resolution 无后缀
- pnpm workspace `workspace:*`；只改简报列出的文件（lockfile 副产物除外）
- 每个任务单提交（Conventional Commits + `Co-Authored-By: OpenCode <noreply@opencode.ai>` trailer）
- 测试全绿 + `pnpm -C apps/api typecheck` 绿 + lint 无警告才允许提交
- 金钱/资源变动全部走「条件 UPDATE + 事务」防并发（TECH-DESIGN §5 并发三件套）

## 协调者裁定（M1-R 系列，已生效）

- **M1-R1** 招募候选池容量 = 5（student.md/gameplay.md 已统一）
- **M1-R2** 手动刷新费 `round(100 × 1.5^k)`（k=当日已刷新次数从 0 计）封顶 800，每日 04:00 重置（economy.yaml 权威）
- **M1-R3** 品质权重 55/30/12/3 + student.md §3.2 分档声誉乘子（gameplay 旧口径已废止）；服务器日界统一 04:00
- **M1-R4** Prisma Student 字段对齐领域键：`ds/dp/math/graph/greedy/str`（STRING 维列名用 `str`）、`code/thinking/setting`、`mindset Float`、`staminaRegen Int`（1–100 刻度，student.md 权威，覆盖 TECH §3 的 Float 系数设计）；新增 `qualityTier` 枚举与 `counters Json`（稀疏计数器：reroll/vigorUsed/focusEngineUsed/milkTea/bookWeek）
- **M1-R5** Config 六表一次建齐（Talent/Item/Problem/Event/Stage/Economy + ConfigImport），M1 仅导入 talents/items/economy 三种，其余三种表的导入器在对应里程碑追加
- **M1-R6** 专项训练（T1.6）依赖 ProblemLibraryEntry——本里程碑建表并由种子脚本提供样例题；题库玩法（出题行动）仍属 M3

---

### Task 1: 配置即数据管线（T1.1）

**Files:**
- Create: `packages/shared/src/config/talents.ts`, `packages/shared/src/config/items.ts`, `packages/shared/src/config/economy.ts`, `packages/shared/src/config/index.ts`（zod schema + 导出类型 TalentDef/ItemDef/EconomyConfig）
- Modify: `packages/shared/src/index.ts`（re-export）、`packages/shared/package.json`（zod 已有）
- Create: `apps/api/src/config/loader.ts`（读 yaml+校验+语义检查+导入+内存缓存）、`apps/api/src/config/semantic.ts`、`apps/api/src/lib/rng.ts`（mulberry32，本任务先建，Task 3 起用）
- Modify: `apps/api/prisma/schema.prisma`（追加 7 张 Config 表）、`apps/api/src/index.ts`（启动时 await importConfigs；VITEST 门控内也执行，用测试 CONFIG_DIR）
- Modify: `apps/api/package.json`（+`yaml` 依赖）
- Test: `apps/api/tests/config-import.test.ts`

**Interfaces:**
- Produces:
  - `CONFIG: Readonly<ConfigBundle>` —— 模块级只读缓存 `{ talents: Record<id,TalentDef>, items: Record<id,ItemDef>, economy: EconomyConfig, sourceHash: string }`
  - `importConfigs(): Promise<ConfigBundle>` —— TECH-DESIGN §4.2 伪代码的 M1 三文件版
  - `mulberry32(seed: number): () => number`
- Consumes: `env.CONFIG_DIR`（env.ts 追加：默认 `docs/data`，测试用 `apps/api/tests/fixtures/config`）

**关键实现点：**

1. **zod schema 从 yaml 实际结构反推**（先读三个 yaml 的头部注释与条目形状）：
   - talents.yaml：61 条，字段含 id/name/rarity/family?/upgradeTo?/effect（meta 键→数值）。schema 校验 rarity 六档枚举、effect 的 meta 键在已知集合内（从 yaml meta 区块提取合法键列表）、upgradeTo 引用存在（语义检查）。
   - items.yaml：80 条 + 文件级 `meta` 区块（合成配方表）——schema 必须允许顶层 meta（集成裁定 #13）。条目字段含 id/name/category/rarity/price（可空）/effect?/sources?。
   - economy.yaml：嵌套配置（recruitment/training/lecture/story/adventure/pvp/passive 等分区）。schema 逐分区建模，数值字段 number、公式串 string。**公式不求值**——代码直接读结构化数值字段（如 `recruitment.recruit_base`）；`price_formula` 串仅作展示。schema 对 M1 所需字段做 required，其余分区 passthrough。
2. **语义检查**（semantic.ts，收集全部错误一次报完）：talent upgradeTo 链无分叉/无合并/无环/稀有度单调升（talents.yaml 自带校验逻辑可参考）；items 的 category/rarity 合法；economy 的 recruitment.quality_mult 四档齐全且 ≥1。
3. **导入幂等**：sourceHash = sha256(三文件原文拼接)；configImport 有同 hash ok 记录则跳过 upsert 直接 loadBundleFromDb。单事务 upsert + 软弃用（deprecated）。
4. **快速失败**：校验失败打印「文件/路径/期望/实得」表格后 `process.exit(1)`（生产）；测试环境 throw FatalStartupError 由测试断言。
5. **migration**：`pnpm prisma migrate dev --name config_tables`，7 表按 TECH-DESIGN §3 的 ConfigTalent/ConfigItem/ConfigProblem/ConfigEvent/ConfigStage/ConfigEconomy/ConfigImport 定义。
6. **GET /api/health 增强**：data 追加 `configVersion: sourceHash.slice(0,12)`（替代 M1 范围的 meta 端点职责）。

- [ ] **Step 1: shared zod schemas（TDD：先写 schema 单测——好 yaml fixture 通过、坏 rarity/坏 upgradeTo 失败）**
- [ ] **Step 2: Prisma 7 表 + migration + generate**
- [ ] **Step 3: loader/semantic 实现（TDD：坏 yaml 报行号、重复导入幂等、软弃用生效）**
- [ ] **Step 4: index.ts 接线 + health configVersion + 全测试绿**
- [ ] **Step 5: 提交 feat(api): 配置即数据管线**

---

### Task 2: 学员域模型与懒结算时钟（T1.2）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（Student/StudentTalent/UserItem/ProblemLibraryEntry/ReputationLog + Sex/QualityTier/StudentStatus 枚举）
- Create: `apps/api/src/lib/clock.ts`（日界/周界工具）、`apps/api/src/modules/students/settle.ts`（懒结算）、`apps/api/src/modules/students/meta.ts`（天赋 meta 聚合）
- Create: `packages/shared/src/domain/student.ts`（StudentView/CountersView 类型 + V 值计算函数）
- Modify: `packages/shared/src/index.ts`
- Test: `apps/api/tests/settle.test.ts`, `apps/api/tests/meta.test.ts`

**Prisma 模型（M1-R4 口径，逐字段实现）：**

```prisma
enum Sex { MALE FEMALE }
enum QualityTier { COMMON GOOD ELITE GENIUS }
enum StudentStatus { ACTIVE DISMISSED }

model Student {
  id           Int           @id @default(autoincrement())
  userId       Int
  name         String        @db.VarChar(24)
  sex          Sex
  qualityTier  QualityTier
  status       StudentStatus @default(ACTIVE)
  // 九维能力（1–100，浮点累积、展示 floor）
  ds Float; dp Float; math Float; graph Float; greedy Float; str Float
  code Float; thinking Float; setting Float
  // 辅助属性与资源
  mindset      Float         @default(2)      // −10…+10
  focusCap     Int
  energyMax    Int
  energy       Float
  stamina      Float         @default(5)      // 上限恒定 5（economy）
  staminaRegen Int                              // 1–100
  counters     Json          @default("{}")   // reroll/vigorUsed/focusEngineUsed/milkTea/bookWeek
  lastSettledAt DateTime     @default(now())
  recruitedAt  DateTime      @default(now())
  dismissedAt  DateTime?
  updatedAt    DateTime      @updatedAt
  user     User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  talents  StudentTalent[]
  @@index([userId, status])
}

model StudentTalent { /* 按 TECH §3：studentId/talentId/acquiredVia/fromTalentId，@@unique([studentId, talentId]) */ }
model UserItem { /* 按 TECH §3：@@unique([userId, itemId])，扣到 0 删行 */ }
model ProblemLibraryEntry {
  id Int @id @default(autoincrement())
  userId Int
  authorStudentId Int?          // 开除作者后置空（student.md §9）
  name String @db.VarChar(64)
  dominantDim String @db.VarChar(8)   // DS/DP/MATH/GRAPH/GREEDY/STRING
  rarity String @db.VarChar(8)        // 六档
  quality Int                          // Q 分 0–100
  consumedAt DateTime?
  createdAt DateTime @default(now())
  @@index([userId, consumedAt])
}
model ReputationLog { /* id/userId/delta Int/reason VarChar(64)/createdAt，@@index([userId, createdAt]) */ }
```

**settle.ts（懒结算，读路径纯投影、写路径行内结算）：**

```ts
export function settle(s: Student, meta: MetaAggregate, now: Date): Student {
  // 1. stamina：+ (2/3)×(staminaRegen/50) 点/小时 × 经过小时，clamp [0,5]
  // 2. energy：+ 10×(1+meta.energy_regen/100) 点/小时，clamp [0,energyMax]
  // 3. mindset 回归：每跨过一个 04:00 日界，向 B=clamp(1+meta.mindset_flat,−10,+10) 移 1 点
  // 4. 返回更新后的对象；调用方负责持久化（写路径内 UPDATE … WHERE updatedAt=旧值 乐观并发）
}
```

**meta.ts**：`aggregateMeta(talentIds: string[]): MetaAggregate`——从 CONFIG.talents 取 effect 叠加同名 meta 键（加算）。

**clock.ts**：`SERVER_DAY_OFFSET_HOUR = 4`；`dayKey(d): string`（04:00 为界的日期键）、`weekKey(d): string`、`crossedDayBoundaries(from, to): number`。

**测试要点**：恢复速率公式锚点（regen=50→45min/点）；不超上限不为负；心态跨 2 个日界移 2 点且不越过 B；并发双写乐观锁失败重试一次成功；meta 聚合加算正确。

- [ ] **Step 1: migration（student_domain）+ shared 类型**
- [ ] **Step 2: clock/meta/settle TDD**
- [ ] **Step 3: 提交 feat(api): 学员域模型与懒结算时钟**

---

### Task 3: 招募模块（T1.3）

**Files:**
- Create: `apps/api/src/modules/academy/name-pool.ts`（内置中文姓名池 ≥120 个 2–3 字名）、`apps/api/src/modules/academy/recruit-gen.ts`（候选生成）、`apps/api/src/modules/academy/service.ts`、`apps/api/src/modules/academy/router.ts`
- Create: `apps/api/src/scripts/recruit-stats.ts`（分布统计脚本，验收用）
- Modify: `apps/api/src/index.ts`（挂载 /api/academy）、`apps/api/prisma/schema.prisma`（RecruitPool 表）+ migration
- Test: `apps/api/tests/academy.test.ts`

**RecruitPool 表：**

```prisma
model RecruitPool {
  userId Int @id
  candidates Json                 // 5 个 CandidatePayload（见下）
  generatedAt DateTime
  refreshesToday Int @default(0)
  refreshDayKey String @db.VarChar(10)   // dayKey，04:00 界
  user User @relation(fields:[userId], references:[id], onDelete: Cascade)
}
```

**CandidatePayload（Json）：**`{ tempId, name, sex, qualityTier, hint, attrs:{ds..setting,focusCap,energyMax,staminaRegen}, talents:[{talentId}] , price }`——hint 按 student.md §3.6 模糊评语；price 预计算 `round(300×1.35^N)×quality_mult`（N=招募时在册数，生成时快照、招募时重算校验）。

**生成规则（recruit-gen.ts，严格按 student.md §3.2–3.6）：**

1. 品质 roll：权重 55/30/12/3 × 声誉乘子（r=min(rep,8000)/8000；common ×(1−0.25r) 等）归一化
2. 属性：§3.3 E±δ 表整数均匀掷点 [1,100]；先算 `E' = round(E × (1+0.15×min(rep,6000)/6000))`（仅六维/code/thinking/setting）
3. 天赋：§3.4 数量表→稀有度表→CONFIG.talents 对应档均匀抽（去重）；genius 首槽绿+保底（绿55/蓝33/紫10/彩2）
4. mindset=+2；性别 50/50；姓名从池抽（池内不去重）

**API：**

| 端点 | 行为 |
|---|---|
| `GET /api/academy/pool` | 懒刷新（距 generatedAt ≥24h 自动重生成）后返回 5 候选 |
| `POST /api/academy/refresh` | 手动刷新：04:00 界重置 refreshesToday；价 `round(100×1.5^k)` cap 800；条件 UPDATE 扣钱不足→INSUFFICIENT_RESOURCE |
| `POST /api/academy/recruit` | body `{tempId}`：事务内重算价→扣钱（条件 UPDATE）→建 Student+StudentTalent→从池移除该候选 |

**测试要点**：池懒刷新 24h 边界；刷新费序列 100/150/225/338/506/759/800 与 04:00 重置；招募扣钱/建学员/天赋落库/池减员；钱不足 409/402 语义（用 INSUFFICIENT_RESOURCE）；声誉乘子单调性（rep=8000 时 genius 概率 > rep=0）；recruit-stats 脚本 10000 次采样的分布落在期望 ±2σ（脚本只跑打印，不进 vitest 断言）。

- [ ] **Step 1: migration（recruit_pool）+ name-pool + recruit-gen TDD（种子随机可复现）**
- [ ] **Step 2: service/router TDD（8+ 用例）**
- [ ] **Step 3: 统计脚本 + 提交 feat(api): 招募模块**

---

### Task 4: 学员管理 API（T1.4 后端）

**Files:**
- Create: `apps/api/src/modules/students/service.ts`, `apps/api/src/modules/students/router.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/students.test.ts`

**API：**

| 端点 | 行为 |
|---|---|
| `GET /api/students` | ACTIVE 列表（每项 StudentView：九维 floor、V 值、心态整数、资源 floor、天赋数组） |
| `GET /api/students/:id` | 详情（含 counters 的 UI 相关项：reroll 计数、vigorUsed 等） |
| `POST /api/students/:id/rename` | `{name}` 2–12 字符；消耗 rename-card×1（无卡→INSUFFICIENT_RESOURCE） |
| `POST /api/students/:id/dismiss` | 开除：声誉 −5/−10/−20/−40（按 qualityTier，写 ReputationLog，声誉 floor 0）；35% 回收 rename-card×1（种子随机）；学员 status=DISMISSED；其 ProblemLibraryEntry.authorStudentId 置空 |

**测试要点**：list 只返 ACTIVE；rename 耗卡与改名落库；dismiss 声誉扣减+日志+概率回收（种子固定验证两支）；非本学员 404/FORBIDDEN。

- [ ] **Step 1: service/router TDD → 提交 feat(api): 学员管理 API**

---

### Task 5: 背包 API（T1.5 后端）

**Files:**
- Create: `apps/api/src/modules/items/service.ts`, `apps/api/src/modules/items/router.ts`, `apps/api/src/modules/items/effects.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/items.test.ts`

**API：**

| 端点 | 行为 |
|---|---|
| `GET /api/items` | 背包列表（join CONFIG.items 补名称/稀有度/类别/描述） |
| `POST /api/items/use` | `{itemId, studentId?, payload?}` 按 effects.ts 分派 |

**effects.ts 实现 M1 范围道具（效果权威 student.md §8 / items.yaml；不实现的类别返回 VALIDATION_FAILED「该道具暂不可用」）：**

| 道具 | 效果实现 |
|---|---|
| rename-card | 不可直接 use（由 rename 端点消耗）→ VALIDATION_FAILED 提示 |
| calm-pill | mindset +3 clamp +10 |
| milk-tea | mindset +1；counters.milkTea 日限 2（04:00 界） |
| stamina-potion | stamina +3 clamp 5 |
| coffee | energy +15 clamp energyMax |
| vigor-drink | energyMax +3；counters.vigorUsed 限 3 |
| focus-engine | focusCap +8（≤100）；counters.focusEngineUsed 限 2 |
| 直用书 book-thinking/code/setting ×5 档 | 固定增益 灰+2/黄+4/绿+7/蓝+12/紫+20 ×(1+meta.book_effect/100)；counters.bookWeek 同学员同属性周限 10 点（weekKey 界） |
| advance-stone / reroll-ticket / reroll-shard / direction-charm / legend-box / tag-card / badge 类 | M1 不可用 → VALIDATION_FAILED（升阶/洗练 UI 属后续里程碑） |

全部效果在事务内：锁学员行→settle→校验限制→应用→扣道具（quantity−1，0 删行）。

**测试要点**：每道具一正例；限制类反例（milk-tea 第 3 杯、vigor 第 4 次、书周限 10 点后）；库存扣减与删行；不存在道具 404。

- [ ] **Step 1: effects + router TDD → 提交 feat(api): 背包与道具使用**

---

### Task 6: 训练 API（T1.6 后端）

**Files:**
- Create: `apps/api/src/modules/training/service.ts`, `apps/api/src/modules/training/router.ts`, `apps/api/src/modules/training/gains.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/training.test.ts`

**API：**

| 端点 | body | 行为 |
|---|---|---|
| `POST /api/training/basic` | `{studentId}` | 随机一维（均匀），base 1.6 |
| `POST /api/training/directed` | `{studentId, dim}` | 耗对应六维书×1（稀有度→BookMult），base 2.0 |
| `POST /api/training/specialized` | `{studentId, problemId}` | 耗预制题（consumedAt 标记），目标维=题 dominantDim，base 3.2 ×QualityMult |

**结算管线（gains.ts，严格 student.md §4.3）：**

```
Δ = base × BookMult × QualityMult × (1+meta.training_all/100) × (1+meta.training_<dim>/100)
    × (1 − cur/100)^2        // 浮点累积；cur≥100 时 Δ=0
费用 = round(economy.training.<type>_base × (1 + 0.08×(N−1)))     // N=在册学员数
体力 −1（条件 UPDATE stamina>=1）；附带成长 §4.5：code/thinking 概率表 + 四项稀有成长
```

前置校验：学员 ACTIVE、stamina≥1（先 settle）、钱足、定向需书、专项需题（未消耗、本人题库、dominantDim 合法）。响应 `TrainingResult { dim, delta, rareGains[], cost, staminaAfter }`。

**测试要点**：收益公式锚点（cur=10 base=1.6 → ≈1.296 落库浮点）；费用 N=1/5 锚点；书耗/题耗；体力 0→STATE_CONFLICT；钱不足；稀有成长种子固定可复现；cur=100 Δ=0。

- [ ] **Step 1: gains + service + router TDD → 提交 feat(api): 训练系统**

---

### Task 7: 前端页面（学员/招募/背包/训练）

**Files:**
- Create: `apps/web/src/features/students/StudentsPage.tsx`, `apps/web/src/features/students/StudentDetailPage.tsx`, `apps/web/src/features/academy/AcademyPage.tsx`, `apps/web/src/features/items/InventoryPage.tsx`, `apps/web/src/features/training/TrainingPage.tsx`
- Modify: `apps/web/src/app/App.tsx`（路由 + 侧导航占位替换）、`apps/web/src/lib/api.ts`（如需）
- 无测试框架（M0 未建 web 测试）——手动走查清单验收

**页面要点（信息架构照 TECH-DESIGN §8；风格沿用 M0 设置页）：**

- StudentsPage：卡片列表（姓名/品质档/V/六维条/心态/体力精力），点入详情
- StudentDetailPage：九维面板 + 天赋区（名称/稀有度色/effect 描述）+ 改名（有 rename-card 才可用）+ 开除（二次确认，显示声誉惩罚与 35% 回收提示）
- AcademyPage：5 候选卡（气质提示/价格）+ 招募按钮 + 手动刷新（显示下次价格）+ 免费刷新倒计时
- InventoryPage：分类分组列表，可用道具带「使用」按钮（需选学员的弹选择器）
- TrainingPage：选学员→三 Tab（基础/定向/专项）→定向选维+选书、专项选题→结果显示 delta 与稀有成长 toast
- 全部 react-query 封装到 `lib/hooks.ts`；mutation 后失效相关 query

**验收（手动走查记录进报告）**：招募→训练（三种）→用书→改名→开除→刷新池，全链路 UI 可用、数值与 API 一致。

- [ ] **Step 1: hooks + StudentsPage/Detail → Step 2: Academy → Step 3: Inventory/Training → Step 4: 走查 + build/typecheck/lint 绿 → 提交 feat(web): M1 前端页面**

---

### Task 8: 种子脚本与 M1 收尾（T1.7 + 质量门）

**Files:**
- Create: `apps/api/src/scripts/seed.ts`（pnpm -C apps/api seed）
- Modify: `apps/api/package.json`（+seed 脚本）、`docs/ROADMAP.md`（勾选 T1.x）
- Test: 种子后冒烟（用 curl 走关键端点，记录进报告）

**seed.ts 内容**：演示账号 coach/demo1234（钱 5000、声誉 100）；3 名样例学员（common/good/elite 各一，属性按 §3.3 中值）；背包样例道具（改名卡×2、六维书若干、calm-pill×3、stamina-potion×2、vigor-drink×1）；样例预制题 2 道（专项训练可用）；触发一次免费招募池生成。幂等：已存在 demo 账号则跳过。

**收尾**：`pnpm install && pnpm typecheck && pnpm lint && pnpm test` 全绿 → ROADMAP T1.1–T1.7 勾选 + 实测记录（环境：本地 MariaDB 进程直跑）→ 提交。

- [ ] **Step 1: seed + 冒烟 → Step 2: 质量门 + ROADMAP → 提交 chore/docs**

---

## Self-Review 记录

1. **Spec 覆盖**：ROADMAP T1.1→Task1、T1.2→Task2、T1.3→Task3、T1.4→Task4+7、T1.5→Task5+7、T1.6→Task6+7、T1.7→Task8。✓
2. **冲突预扫**：Task3 依赖 Task1 的 CONFIG 与 Task2 的 Student 表；Task4/5/6 依赖 Task2 settle/meta；Task7 依赖 Task3–6 端点契约（本计划已固定）。串行执行无共享写冲突。✓
3. **数值唯一来源**：钱→economy.yaml、机制→student.md、流程→gameplay.md，本计划未新造任何数值。✓
4. **类型一致**：StudentView/TrainingResult 在 Task2/6 的 shared 定义与 Task7 消费一致；ErrorCode 复用 M0 枚举（INSUFFICIENT_RESOURCE/STATE_CONFLICT/VALIDATION_FAILED/NOT_FOUND 已存在）。✓
