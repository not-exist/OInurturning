# T5.1 收支模拟设计

## 目标

提供一个无数据库依赖、可重复执行的周经济模拟器。模拟器读取 `docs/data/*.yaml`，计算新手周、中期周、后期周三类玩家画像的收入、支出、净额和收入/支出比，并自动判断中期画像是否落在 `economy.yaml` 声明的 `[0.90, 1.15]` 区间。

## 范围

本任务只验证钱币经济，不模拟声誉、体力和属性成长的逐日状态变化。声誉和能力作为画像输入，用于讲课报酬等公式；体力只用于人工检查行为次数是否合理。T5.2 的养成耗时与进阶石稀缺性另行计算，但复用本任务的配置加载和报告结构。

本任务不直接调整平衡数值。若当前配置不达标，先输出失败报告，再以独立配置变更调整 `docs/data/*.yaml` 并附前后对比。

## 配置结构

在 `economy.yaml` 新增严格校验的 `simulation` 分区：

```yaml
simulation:
  target_profile: mid
  profiles:
    - id: beginner
      label: 新手周
      owned_students: 3
      ability: 30
      reputation: 50
      training:
        basic_sessions: 6
        directed_sessions: 2
        specialized_sessions: 1
        directed_book_item_id: book-ds-yellow
      recruitment:
        recruits_per_week: 0.25
        quality: common
        manual_refreshes_per_week: 1
      lectures: {sessions: 4, tier: junior}
      adventures:
        sessions: 4
        rarity_mix: {gray: 3, yellow: 1}
      story: {sessions: 2, stage_key: "csps:1", rank_tier: third_to_eighth, ng_level: 0}
      passive: {sponsor_contracts: 0, substitute_coaches: 0}
      fixed_weekly_expense: 100

    - id: mid
      label: 中期周
      owned_students: 5
      ability: 50
      reputation: 200
      training:
        basic_sessions: 5
        directed_sessions: 4
        specialized_sessions: 2
        directed_book_item_id: book-ds-green
      recruitment:
        recruits_per_week: 0.5
        quality: common
        manual_refreshes_per_week: 1
      lectures: {sessions: 5, tier: senior}
      adventures:
        sessions: 5
        rarity_mix: {gray: 1, yellow: 1, green: 1}
      story: {sessions: 2, stage_key: "noip:1", rank_tier: third_to_eighth, ng_level: 0}
      passive: {sponsor_contracts: 0, substitute_coaches: 1}
      fixed_weekly_expense: 300

    - id: late
      label: 后期周
      owned_students: 10
      ability: 92
      reputation: 3000
      training:
        basic_sessions: 3
        directed_sessions: 2
        specialized_sessions: 3
        directed_book_item_id: book-ds-purple
      recruitment:
        recruits_per_week: 0.1
        quality: elite
        manual_refreshes_per_week: 2
      lectures: {sessions: 4, tier: national}
      adventures:
        sessions: 6
        rarity_mix: {blue: 3, purple: 1}
      story: {sessions: 1, stage_key: "ioi:1", rank_tier: third_to_eighth, ng_level: 1}
      passive: {sponsor_contracts: 1, substitute_coaches: 1}
      fixed_weekly_expense: 1000
```

以上是 T5.1 的最终画像输入。中期画像复现现有 `sinks_summary` 的主要行为口径；新手和后期画像分别覆盖低档课程/低价书与国家队课程/NG+/高价书。计算代码不得包含这些平衡数字。

字段规则：

- `id` 固定为 `beginner | mid | late`，不得缺项或重复。
- 次数和固定支出均为非负数；`recruits_per_week` 可为小数，表达摊销频率。
- `rarity_mix` 权重非负且至少一项大于 0；计算时归一化，允许使用易审计的整数权重。
- `tier` 必须引用 `lecture.audience_tiers[].id`。
- `directed_book_item_id` 必须引用 `items.yaml` 中有价格的书籍。
- `stage_key` 必须引用 `stages.yaml` 的真实关卡；`rank_tier` 使用 `champion | runner_up | third_to_eighth`。
- `target_profile` 指向 `mid`，目标区间继续由 `meta.calibration_profile.target_income_expense_ratio` 定义。

`packages/shared/src/config/economy.ts` 负责结构校验；跨文件引用和权重总和由 API 配置 semantic checks 与模拟器加载器共同拒绝。

## 计算模型

所有金额先按单项公式计算，行项目取整后再汇总。

支出：

- 基础、定向、专项训练：`round(money_base * (1 + student_coeff * (owned_students - 1))) * sessions`。
- 定向书籍：`items.yaml` 对应书价乘 `directed.book_consumed` 和定向次数。
- 招募摊销：`round(recruit_base * recruit_growth ^ owned_students) * quality_mult * recruits_per_week`，最终行项目四舍五入。
- 手动刷新：按每周均从当日首次付费刷新开始计算；若未来需要多次，则逐次套用增长并执行日封顶。
- 其他支出：画像的 `fixed_weekly_expense`，承载应急杂项等不可从现有公式可靠推导的期望值。

收入：

- 讲课：找到画像指定档位，按现有 `reputation_pay_curve` 和 `overflow_bonus` 计算单次报酬，再乘次数。`ability - threshold` 的完整步数决定溢出倍率。
- 历练：每个稀有度使用 `adventure.money_ranges_by_rarity` 的区间中点，再按 `rarity_mix` 求期望，乘次数后取整。
- 剧情重复通关：从 `stages.yaml` 找到画像关卡所属章节的 M 基数，乘 `contest.rank_coeffs`、NG+ 倍率和次数。
- 被动收入：赞助使用配置区间中点乘有效合约数和 7 天；代课使用指定上限课程的基础收入、玩家分成、每周次数和教练数。

汇总：

- `incomeTotal` 和 `expenseTotal` 为各自明细之和。
- `net = incomeTotal - expenseTotal`。
- `ratio = incomeTotal / expenseTotal`，支出为 0 时返回 `null`，不得产生 `Infinity`。
- 只有 `target_profile` 参与通过/失败门槛；新手和后期画像用于趋势观察，不设置未经规格授权的硬阈值。

## 代码结构

- `packages/shared/src/config/economy.ts`：增加 simulation schema 与导出类型。
- `apps/api/src/modules/economy/simulation.ts`：纯函数计算内核，只接受已解析的 economy/items/stages 数据并返回结构化报告。
- `apps/api/src/scripts/sim-economy.ts`：加载三份 YAML、执行 schema/semantic 校验、渲染表格或 JSON。
- `scripts/sim-economy.ts`：根目录 CLI 入口，仅转交给 API 脚本，保持 `TECH-DESIGN.md` 既定路径。
- `apps/api/tests/economy-simulation.test.ts`：公式、边界、配置引用和三画像验收测试。
- 根 `package.json`：增加 `pnpm sim:economy` 命令。

不接入数据库，不复用需要启动环境变量的全量配置导入器，避免校准脚本依赖 MySQL 或 JWT 配置。

## 输出契约

默认输出三个画像的文本表格，每个画像包含收入明细、支出明细、合计、净额、比例和目标状态。表尾明确打印中期目标区间与 PASS/FAIL。

`--json` 输出稳定 JSON：

```json
{
  "profiles": [
    {
      "id": "mid",
      "income": [{ "key": "lectures", "amount": 2520 }],
      "expenses": [{ "key": "training.basic", "amount": 395 }],
      "incomeTotal": 3990,
      "expenseTotal": 3804,
      "net": 186,
      "ratio": 1.0489
    }
  ],
  "target": { "profileId": "mid", "min": 0.9, "max": 1.15, "actual": 1.0489, "pass": true }
}
```

键顺序和画像顺序固定为 `beginner, mid, late`，便于代码审查前后 diff。目标画像失败时 CLI 退出码为 1；配置或引用错误同样退出 1，并输出具体 YAML 路径。

## 测试与验收

- 单元测试覆盖训练成本、讲课倍率、历练加权、剧情 NG+、被动收入、零支出 ratio。
- 配置测试覆盖三画像齐全、稀有度权重和跨文件引用。
- 真实 YAML 集成测试断言三份报告均有限数、明细之和等于合计、中期比例处于目标区间。
- CLI 测试或直接执行验证文本和 `--json` 两种输出；`pnpm sim:economy` 必须以 0 退出。
- 最终执行 API 全量测试、workspace typecheck/lint/build 和 `git diff --check`。

## 非目标

- 不引入随机采样、数据库状态或玩家历史数据。
- 不将 `sinks_summary` 的旧手工总数作为模拟结果输入；实现完成后以脚本结果替代其权威性，旧区块只保留说明或同步为生成结果。
- 不在 T5.1 计算训练到 IOI 的时间或进阶石供需，这两项属于 T5.2。
- 不在此阶段提前进行 T5.3 的浏览器视觉走查或 T5.4 的完整部署验收。
