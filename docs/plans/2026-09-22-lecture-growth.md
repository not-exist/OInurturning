# 讲课成长（issue #56「讲课能够提升学生水平」）— 实施计划与落地记录

> 本文既是实施计划（可直接投喂执行者），也是执行记录：§3 的落地清单与 §7 的验证结果均为**已在仓库落地并跑过**的内容。
> 权威口径分工不变：玩法规则 → `docs/systems/gameplay.md §4.2.1`；数值 → `docs/data/economy.yaml → lecture.growth`；技术约定 → `docs/TECH-DESIGN.md`。

---

## 0. 需求与裁定

**issue #56**（`enhancement`，2026-09-22 开，无正文、无评论）：`讲课能够提升学生水平`。

标题即全部需求，细节由本次裁定补齐（四条硬约束，后续调数值不得违背）：

| # | 裁定 | 落到实现 |
|---|---|---|
| 1 | **成长落点**：出题 + 思维为主，落点随机；**思维不足强行讲课有概率减少属性**；**思维明显超出要求时几乎不增加** | 只写 `setting`/`thinking` 两列；匹配系数 `g(d)` 在超出侧衰减到 0；讲砸 + 思维不足 → 负增量 |
| 2 | **强度**：弱于训练、不动现有收入（讲课仍是主收入） | `base_gain = 0.75`（训练 base 1.6/2.0/3.2），讲课体力 2 → 每点体力成长约为基础训练的 **23%**；钱/声誉公式零改动 |
| 3 | **交付范围**：计划文档 + 全栈实现（后端 + 前端 UI + 文档 + 测试） | 见 §3 落地清单（18 个文件改动 + 4 个新增文件） |
| 4 | **配置化**：数值走 `economy.yaml`，并新增天赋 meta 键 | `lecture.growth` 分区 + `lecture_growth` meta 键 + zod schema + 语义校验 |
| 5 | 配套 **unit test / e2e** | 见 §5 测试矩阵 |

---

## 1. 改动前的事实（勘察结论）

| 事实 | 证据 |
|---|---|
| 讲课只结算「钱 + 声誉 + 体力 + 心态」，学员能力一律不动 | `apps/api/src/modules/academy/lecture.ts` 的 `teachLecture()`：`student.updateMany` 只写 `stamina/energy/mindset/lastSettledAt` |
| `LectureLog` 无任何成长列 | `apps/api/prisma/schema.prisma` 的 `model LectureLog`（迁移 `20260902150000_lecture_logs`） |
| 成长管线已有一套成熟范式可复用 | `apps/api/src/modules/training/gains.ts`：纯函数 + 注入 rng + `(1−cur/100)^2` 阻尼 + `RareGain[]` 落 `Json` 列 |
| **V 不得参与奖励结算**（本设计的关键约束） | `docs/systems/student.md §1`：「任何奖励结算不得直接引用 V」 |
| 讲课次数闸已存在，无需再加成长闸 | `DAILY_LECTURE_LIMIT = 3` / `DAILY_STUDENT_LECTURE_LIMIT = 2` |
| 强接讲砸判定已是 40% 概率闸 | `createRandomStream(…, 'lecture-risk')() >= 0.4` |
| 天赋 meta 键新增会强制前端补文案 | `apps/web/src/lib/labels.ts` 的 `TALENT_STAT_LABEL satisfies Record<TalentEffectStat, string>` |
| R8「代课请求」尚未接通讲课结算 | `apps/api/src/modules/adventure/service.ts:434` 把 `lecture` 奖励列入 `unsupported` 并抛 `STATE_CONFLICT` |

---

## 2. 设计方案

### 2.1 成长落点：只有「讲得出来」的两项

讲课是把**已有理解**讲清楚，不是学新知识 → 只提升 `setting`（出题）与 `thinking`（思维），**不触及六维与 code**。类型层收口在 `packages/shared/src/domain/student.ts`：

```ts
export const LECTURE_GROWTH_STATS = ['setting', 'thinking'] as const;
export interface LectureGrowthEntry { stat: LectureGrowthStat; amount: number } // amount 可为负
```

落点随机：每场先按 `setting_weight = 0.55` 抽主落点（否则 `thinking`），再以 `secondary_prob = 0.20` 判定另一项的附带成长（量为主成长的 `secondary_share = 0.35`）。

### 2.2 匹配系数：思维 vs「该档思维要求 R」（需求 ①③ 的核心）

每档一个 `thinking_req`（缺省 = 该档 V 门槛；现值 15/30/45/62/80）。**判定读思维能力本身而非 V**，因此「六维高、思维薄」的学员即便 V 达标也拿不到全额成长——这正是 student.md §1 的约束所要求的解耦。

```
d = 学员思维 − R
d ≥ 0：g = max(0, 1 − d/match_span)^match_power      match_span = 20、match_power = 1.5
d < 0：g = clamp(1 + d/match_span, deficit_floor, 1)  deficit_floor = 0.35
```

实测曲线（`node` 复算，见 §7）：

| d（思维 − R） | −8 | −5 | 0 | +5 | +10 | +15 | ≥+20 |
|---|---|---|---|---|---|---|---|
| g | 0.60 | 0.75 | **1.00** | 0.6495 | 0.3536 | 0.125 | **0** |

即「讲与自己水平相当的课收获最大」；**思维超出要求 20 点及以上 → 成长归零**（需求③「几乎不增加」），思维不足则线性打折但守住 0.35 下限。

### 2.3 单场成长量

```
Δ = base_gain(0.75)
  × g                                    （§2.2 匹配系数）
  × (forced ? forced_success_mult(0.6) : 1)   （强接「勉强过关」折减，与报酬 ×0.6 同源）
  × (1 + lecture_growth/100)             （新天赋 meta 键）
  × (1 − cur/100)^2                      （student.md §4.1：cap=100、k=2、浮点累积）
```

手感锚点（无天赋、g=1）：`cur=20 → 0.48/场`、`cur=45 → 0.2269`、`cur=50 → 0.1875`、`cur=80 → 0.03`。

### 2.4 思维不足 + 强接 + 讲砸 → 属性回落（需求①后半句）

**不新增随机层**：概率闸沿用既有 40% 讲砸判定。命中且 `思维 < R` 时额外付出：

```
思维 −0.8、出题 −0.5   （浮点，clamp 下限 0；与「收入 0 / 声誉 −2×档位序号 / 心态 −2」叠加）
```

思维达标而 V 不足导致的讲砸**不回落**（回落只由思维不足触发）——避免惩罚「六维型」学员的正常强接。

### 2.5 情形矩阵（实现与测试共用的口径表）

| 情形 | 成功? | 思维 vs R | 结果 |
|---|---|---|---|
| 达标直讲 | 必成功 | ≥ R | 全额成长（g 随超出量衰减） |
| 达标直讲，思维远超 R | 必成功 | ≥ R+20 | **无成长**（g=0），报酬照旧 |
| 达标直讲，思维不足（六维型） | 必成功 | < R | 成长打折（g<1），**不回落** |
| 强接勉强过关 | 60% | ≥ R | 成长 ×0.6 |
| 强接勉强过关 | 60% | < R | 成长 ×0.6×g(<1) |
| 强接讲砸 | 40% | ≥ R | 无成长、无回落 |
| 强接讲砸 | 40% | < R | **思维 −0.8、出题 −0.5** |
| 任一情形，属性已达 100 | — | — | 该列 Δ=0（阻尼为 0） |

### 2.6 平衡定位（为什么这套数值不破坏经济）

- 每点体力成长：讲课 `0.75/2 = 0.375` vs 基础训练 `1.6/1 = 1.6` → **23%**；训练仍是成长主轴。
- 单学员日上限：2 场 × 0.75 = 1.5（低 cur 时的理论上界），实际中期约 0.4/日。
- 钱/声誉/体力/心态公式**零改动** → `economy/simulation.ts` 与 `balance-regression` 的收支结论不变（§7 已跑）。
- 期望值自洽：强接一场 ≈ `0.6×成长 − 0.4×回落` ≈ 0，配合既有的声誉惩罚，「强接是亏的」这一取向被强化而非削弱。

### 2.7 确定性与审计

- rng 流：与讲砸判定同一 base seed（`deriveSeed(userId, studentId, tier, dayKey, 当日场次)`）、不同 label `'lecture-growth'` → **同 seed 必复现**。
- rng 消费顺序固定：① 主落点 → ② 附带判定；讲砸分支不消费 rng。
- 落库：`LectureLog` 新增 `thinkingReq` / `thinkingDeficit` / `gains Json`（`LectureGrowthEntry[]`），与 `TrainingLog.rareGains` 同风格，可复盘「为什么这场没涨」。

### 2.8 配置与天赋接口

```yaml
lecture:
  audience_tiers:
    - { id: beginner, threshold: 15, ..., thinking_req: 15 }   # 五档：15/30/45/62/80
  growth:
    base_gain: 0.75
    setting_weight: 0.55
    secondary_prob: 0.20
    secondary_share: 0.35
    forced_success_mult: 0.60
    match_span: 20
    match_power: 1.5
    deficit_floor: 0.35
    forced_deficit_loss: { thinking: 0.8, setting: 0.5 }
```

- zod：`lectureGrowthSchema`（`.passthrough()` 放行 `rule/match_rule` 文档键）；`growth` 在 `lectureConfigSchema` 中**可选**（历史配置/精简 fixture 兼容），运行期由 `growthConfig()` 缺失即抛错。
- 天赋：新增 meta 键 `lecture_growth`（%）→ 讲台之星 15%/25%、教学相长 30%。
- 语义校验（`apps/api/src/config/semantic.ts`）：`thinking_req` 必须**严格递增**且落在 `[门槛−8, 门槛]`（高于门槛会让达标学员恒定「思维不足」，低于窗口会让强接永不付代价）；`secondary_share ≤ 1`。

---

## 3. 落地清单

**新增**

| 文件 | 内容 |
|---|---|
| `apps/api/src/modules/academy/lecture-growth.ts` | 纯函数层：`thinkingReqOf` / `matchFactor` / `computeLectureGrowth`（133 行，无 DB 句柄） |
| `apps/api/tests/lecture-growth.test.ts` | 18 个 DB-free 单测（240 行） |
| `apps/api/prisma/migrations/20260922120000_lecture_growth/` | 3 条 `ALTER TABLE LectureLog ADD COLUMN` |
| `docs/plans/2026-09-22-lecture-growth.md` | 本文 |

**修改**

| 层 | 文件 | 改动 |
|---|---|---|
| shared | `packages/shared/src/config/economy.ts` | `lectureTierSchema += thinking_req?`；新增 `lectureGrowthSchema`；`lectureConfigSchema += growth?` |
| shared | `packages/shared/src/config/talents.ts` | `TALENT_META_STATS += 'lecture_growth'` |
| shared | `packages/shared/src/domain/student.ts` | `LECTURE_GROWTH_STATS` / `LectureGrowthStat` / `LectureGrowthEntry` |
| api | `src/modules/academy/lecture.ts` | `growthConfig()`；`LectureTierView += thinkingReq`；`LectureResultView += thinkingReq/thinkingDeficit/gains`；`teachLecture` 内结算成长并同事务写回 + 落库；meta 聚合去重（`aggregateMeta` 由 2 次调用收敛为 1 次） |
| api | `src/config/semantic.ts` | 讲课成长语义校验（§2.8） |
| api | `prisma/schema.prisma` | `LectureLog += thinkingReq/thinkingDeficit/gains` |
| api | `vitest.config.unit.ts` | 把 `tests/lecture-growth.test.ts` 纳入 unit 套件（无 DB、可并行） |
| api | `tests/lecture.test.ts` | +4 个集成用例（§5） |
| web | `src/lib/hooks.ts` | `LectureTierView` / `LectureResultView` 同步新字段 |
| web | `src/lib/labels.ts` | `lecture_growth` 文案；`LECTURE_GROWTH_STAT_LABEL` / `lectureGrowthStatLabel` / `signedTrim` |
| web | `src/features/academy/AcademyLecturePage.tsx` | 档位卡显示思维要求；能力比对新增「思维 / 本场要求」提示行（`data-testid="lecture-thinking-match"`）；结果条新增成长读（`data-testid="lecture-gains"`）；记录行显示逐场增量（`data-testid="lecture-log-gain"`）；强接提示补「思维不足会掉属性」 |
| 配置 | `docs/data/economy.yaml` | 五档 `thinking_req` + `lecture.growth` 分区 |
| 配置 | `docs/data/talents.yaml` | meta 键注释 + 3 条天赋挂 `lecture_growth` |
| 文档 | `docs/systems/gameplay.md` | 新增 §4.2.1 讲课成长 + §6 数值速查 3 行 |
| 文档 | `docs/systems/student.md` | §4.6 增列「讲课成长」为成长来源（含唯一的属性负向来源） |
| 文档 | `docs/GAME-DESIGN.md` | §12 讲课条目补成长语义 |
| 文档 | `docs/TECH-DESIGN.md` | API #24 响应要点补 `gains/thinkingReq/thinkingDeficit` |
| e2e | `tests/e2e/specs/lecture.spec.ts` | +1 用例（§5） |

---

## 4. 数据迁移与兼容

- 迁移 `20260922120000_lecture_growth`：三条 `ADD COLUMN`，均带默认值（`0` / `false` / `('[]')`），**存量行无需回填**，旧读路径不受影响。
- `gains` 用 `JSON NOT NULL DEFAULT ('[]')`，与既有 `AdventureLog.studentIds`（`20260916120000_adventure_roster`）同写法；测试库 `global-setup.ts` 会剥离 JSON 表达式默认值以兼容 MySQL 8.0.13 以下，此时表为空，无影响。
- API 为**加法变更**：只新增响应字段，未改任何既有字段语义；前端旧字段渲染不变。
- 配置为**加法变更**：`growth` 在 zod 层可选 → 精简 fixture（`tests/fixtures/config/economy.yaml` 的 `lecture: {note: …}`）继续走 passthrough 分支，无需改 fixture。

---

## 5. 测试矩阵

| 层 | 文件 | 用例 | 需要 DB |
|---|---|---|---|
| 单元（纯函数） | `apps/api/tests/lecture-growth.test.ts` | 配置契约（五档 R、量级弱于训练）；`matchFactor` 三段曲线；达标全额成长与落点抽取；附带成长与 rng 顺序；**思维远超 → 空成长**；cap/阻尼；`lecture_growth` 放大；确定性；**讲砸回落 + clamp 0**；勉强过关折减；**思维达标讲砸不回落**；档位 R 缺省回退 | ✗ |
| 集成 | `apps/api/tests/lecture.test.ts` | ① 成长写回 `setting/thinking` 且 `money=360` 不变、日志落 `gains/thinkingReq`；② 思维 65 vs R45 → `gains=[]` 且两列不动；③ 强接思维不足 → 成功=正成长 / 讲砸=回落（−0.8/−0.5），两分支都逐列核对；④ 思维足而 V 不足讲砸 → 属性不动 | ✓ |
| e2e | `tests/e2e/specs/lecture.spec.ts` | 思维要求随档位联动（入门组 15 → 国家队 80，并出现「思维不足」文案）；讲课后成长读可见；页面判定「成长最高」时记录行必现成长 chip | ✓（全栈） |
| 回归 | 既有 13 个 unit 文件（含 `economy-simulation` / `balance-regression` / `config-m2-schema`） | 收支与配置校验不受影响 | ✗ |

---

## 6. 文档同步（已完成）

`docs/systems/gameplay.md §4.2.1`（规则权威）→ `docs/data/economy.yaml`（数值权威）→ `docs/systems/student.md §4.6`（成长来源清单）→ `docs/GAME-DESIGN.md §12`（总纲）→ `docs/TECH-DESIGN.md` API 表 #24。

---

## 7. 验证结果（本仓库实际执行）

沙箱环境：Node v22.22.3、pnpm 10.14.0（corepack 启用）。**无 MySQL/MariaDB 可用**（apt 源与本沙箱的出网白名单只放行 `registry.npmjs.org` / `github.com`），故依赖数据库的套件无法在此运行，见下表「未跑」列。

| 命令 | 结果 |
|---|---|
| `pnpm -r typecheck` | ✅ 3/3 通过（shared / api / web）。中途抓到并修掉 2 个真实错误：`Json → LectureGrowthEntry[]` 断言、单测里模块级 const 的窄化不进闭包 |
| `pnpm -r lint` | ✅ 3/3 通过 |
| `pnpm -r build` | ✅ api（tsup）+ web（vite，2049 模块）均成功 |
| `pnpm --filter @oinur/api test:unit` | ✅ **14 文件 / 155 用例全绿**（改动前基线 13 文件 / 137 用例 → 新增 18 个讲课成长用例） |
| `pnpm e2e:typecheck` | ✅ 通过（新 e2e 用例类型正确） |
| 配置管线直检（临时脚本跑 `economyConfigSchema`/`talentsFileSchema` + `runSemanticChecks`） | ✅ `docs/data` 语义问题 **0**；`growth` 九项参数按预期解析；`thinking_req = 15/30/45/62/80`；`lecture_growth` 挂在 `lect-green:15% / lect-blue:25% / mentor-green:30%`；反向用例把 `senior.thinking_req` 改成 99 → 语义层如期报出「须落在 [37, 45]」+「必须严格递增」两条 |
| `pnpm --filter @oinur/api test:integration` | ⚠️ **未跑**：需要 MySQL（`tests/global-setup.ts` 会连 `127.0.0.1:3306` 建库并应用迁移），本沙箱装不上数据库服务 |
| `pnpm e2e` | ⚠️ **未跑**：需要 mysql + api + web 全栈与 Playwright 浏览器 |

> 过程中自查出并修掉的一个**会炸生产的问题**：最初写进 `economy.yaml` 的 `growth.rule` / `match_rule` 两行含未加引号的冒号，YAML 直接解析失败（`Nested mappings are not allowed in compact mappings`），会让 `importConfigs()` 启动即死。已加引号，并由 `lecture-growth.test.ts` 与上述配置直检双重把关。

CI 侧（`.github/workflows/test.yml` / `e2e.yml` 带 mysql:8.4 服务）会覆盖上表两个「未跑」项；本地补齐方式：`pnpm db:up && pnpm --filter @oinur/api test:integration && pnpm e2e`。

---

## 8. 风险、未做与后续

| 项 | 说明 |
|---|---|
| 经济模拟未计入成长 | `modules/economy/simulation.ts` 的画像 `ability` 是固定输入，只算收支；成长不改变任何钱/声誉公式，故当前结论有效。若要做「成长轨迹」模拟，需另立画像维度 |
| R8 代课未接通 | `adventure/service.ts:434` 仍把 `lecture` 奖励列为未实现。将来接通时应直接复用 `teachLecture()`（自动继承成长），并落实 events.yaml 的 `uses_daily_quota: false` |
| 数值待实测 | `base_gain / match_span / 回落量` 为设计基线，建议上线后按「讲课场次 vs 训练场次的体力分配」实测调参（改 yaml 即可，代码无需动） |
| 总览页未展示成长 | `OverviewPage` 的 recent.lectures 仍只显示钱/声誉；如需可复用 `lectureGrowthStatLabel` + `signedTrim` 一行接入 |
| 集成/e2e 需 CI 兜底 | 本沙箱无 DB，两个套件靠 CI 执行（§7） |
