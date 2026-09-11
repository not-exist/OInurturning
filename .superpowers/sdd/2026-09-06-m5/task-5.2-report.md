# T5.2 数值平衡回归 — TDD 交接报告

> 日期：2026-09-09 ｜ 分支：arena/01a08546-oinurturning
> 权威口径：`docs/ROADMAP.md` M5 T5.2、`docs/GAME-DESIGN.md` §7.3/§6.2、`docs/systems/student.md` §1/§3/§4

## 交付物

| 文件 | 说明 |
|---|---|
| `apps/api/src/modules/economy/progression.ts` | 纯函数成长引擎：V 公式、解析会话数、宏步期望推进 `sessionsToV`（确定性、无 DB/随机/数值字面量） |
| `apps/api/src/scripts/balance-regression.ts` | DB-free CLI `run(argv, opts)`：加载 5 份 YAML → 语义校验 → 成长矩阵 + 进阶石账本 → 文本/JSON 报告与 gate |
| `scripts/balance-regression.ts` | 根入口（tsx 薄壳，镜像 sim-economy） |
| `apps/api/tests/balance-regression.test.ts` | 11 例 DB-free vitest（纯函数 5 + CLI 6） |
| `package.json` | 新增 `pnpm bal:regress` |
| 小幅改动 | `training/gains.ts` 导出 `SECONDARY_PROB`（附带成长概率单一事实源，progression 消费）、`academy/recruit-gen.ts` 导出 `ATTR_TABLE`（招募基线单一事实源） |

口径：成长常量取自 `gains.ts`（base 1.6/2.0/3.2、book/quality mult）、招募基线取自 `recruit-gen.ATTR_TABLE` 期望 E；升阶消耗取自 `items.yaml advance-stone.cost_by_target_rarity`；供给取自 `stages.yaml`（正赛里程碑/`ng_plus.advance_stone_per_layer_clear`）与 `events.yaml`（C2 全服限量）；目标 V=各章正赛 `recommended_level`（§6.2 锚点逐关落地，与 V 同刻度）。**任何平衡改动只改 YAML，代码零硬编码（分析阈值除外，已注明）。**

## 实测结果

### A. 训练耗时（无天赋纯训练基线，会话数）

目标（章节正赛 recommended_level）：cspj 19 / csps 38 / noip 58 / province 74 / noi 87 / ctt 91 / cts 94 / ioi 97。

| 品质档＼混合 | cspj | csps | noip | province | noi | ctt | cts | ioi |
|---|---|---|---|---|---|---|---|---|
| common / basic-only | 70 | 241 | 596 | 1,278 | 3,033 | 4,736 | 7,131 | 16,206 |
| common / mid-mix | 55 | 165 | 396 | 858 | 2,046 | 3,146 | 5,060 | 11,451 |
| good / basic-only | 33 | 206 | 555 | 1,238 | 2,996 | 4,672 | 7,094 | 16,169 |
| good / mid-mix | 33 | 132 | 374 | 825 | 2,024 | 3,124 | 5,027 | 11,407 |
| elite / basic-only | 0 | 153 | 506 | 1,176 | 2,934 | 4,622 | 7,044 | 16,119 |
| elite / mid-mix | 0 | 99 | 330 | 781 | 2,002 | 3,080 | 4,983 | 11,363 |
| genius / basic-only | 0 | 70 | 419 | 1,086 | 2,853 | 4,526 | 6,975 | 16,050 |
| genius / mid-mix | 0 | 55 | 275 | 737 | 1,958 | 3,014 | 4,928 | 11,286 |

日历换算：重度 70 次/周（每日两轮清体力+药水）→ ioi ≈3.1 年；轻量 11 次/周（T5.1 中期画像全队周训练量集中主力）→ ioi ≈20 年。IOI 交叉点三组件 ≈ code 96.9 / thinking 97.1 / avg6 98.0 —— V97 需全部贴顶，渐近段是绝对主导；common 与 genius 差异 <2%，品质档优势在前中期（province 前）体现。

### B. 进阶石账本

- 供给：一周目正赛里程碑 10（省选 1 / NOI 2 / CTT 3 / IOI 传说礼盒内含 4）＋ NG+1..3 全通 ×5 = **25 = §7.3 目标 PASS**（`gates.canonicalStones.pass=true`，exit 0）；C2 图灵之遗 3 次/全服周 × 0.35 = **1.05 石/全服周**；PVP 默认 3 石/届（冠军 2 + 亚军 1，管理员节制）。
- 需求：消耗 1/2/3/5/8；灰→彩 19、绿→彩 16（memo、guess 两家族，turing-colorful family=null 仅随机渠道）、单次紫→彩 8 → 均在 25 内，达成 §7.3 稀缺目标，**无需改 YAML**。
- `sim:economy` 复跑：中期 3990/3804=1.0489 PASS（不受影响）。

## 结论与遗留

- gate：**PASS**（25=25）。账本层面 §7.3 目标达成。
- warn：纯训练基线到 IOI 正赛 ≈3.1 现实年（重度）；一周目全通是 NG+（5 石/层）解锁前提 → 若门槛不可及，+15 颗供给名存实亡。本工具以 recommended_level 为 V 阈值代理；**遗留建议**：部署窗口前用真实模拟引擎（`instantiateQuestions`+`simulateRanking`）对 ioi 正赛做通过率校准，再决定是否下调 `stages.yaml` ioi 正赛 NPC/难度。
- 工具口径（无天赋/道具/比赛成长）为成长下界；真实玩家有 training_/training_all 天赋、直用书（code/thinking 每周顶格 10）、赛事实战成长加速。

## 质量门

- 本沙箱环境限制：`binaries.prisma.sh` 网络不可达 → prisma engine 无法下载 → 全量 `typecheck`/`test`/`build` 无法复跑（该限制先于本次改动存在）。
- 已在本沙箱验证：CLI 全量实测 exit 0（1.4s）、64 行矩阵与账本数值如上；eslint 对全部新增/改动文件 0 error；新测试文件 esbuild 语法通过。
- 待开发库环境复跑：`pnpm bal:regress -- --json`、`pnpm -C apps/api exec vitest run tests/balance-regression.test.ts --no-file-parallelism`、workspace `typecheck/lint/build`、`git diff --check`。
