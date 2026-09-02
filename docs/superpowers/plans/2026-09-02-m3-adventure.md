# M3 历练与学院实现计划

**Goal:** 在 M2 比赛内核之上实现可重复、可审计的历练事件闭环，并继续接入高级学院与账号题库。

**Authority:** `docs/systems/gameplay.md`、`docs/data/events.yaml`、`docs/data/economy.yaml`、`docs/systems/student.md`。

## Slice Order

1. T3.1：事件 schema、六文件配置导入、引用/权重语义校验、确定性事件抽取器。
2. T3.2：历练记录与事件状态持久化，体力扣减、情报预览/回避、choice/outcome 结算。基础 fixed/check slice 已完成，duel 分支留给 T3.3。
3. T3.3：事件中的 duel outcome 接入 M2 对决内核并写入 `ContestRecord`。基础接入已完成，R4/P5 奖励依赖后续题库/连胜系统。
4. T3.4–T3.5：高级学院候选池复用 M1 招募池，补讲课门槛、每日额度、报酬与强接风险。
5. T3.6：出题行动、质量评级与 `ProblemLibraryEntry` 入库，复用专项训练和未来 PVP 的题库契约。

## T3.1 Boundary

- `CONFIG.events` 是冻结的内存只读目录；数据库只承载导入审计与回滚所需 payload。
- 抽取器是纯函数，只接受投入档、当前玩家状态、事件历史和 RNG，不访问数据库或时钟。
- 过滤顺序为体力可用性、精确投入层、requirements、冷却、一次性/周限量，再按 rarity 与组内 weight 抽取。
- T3.1 不结算 rewards，不扣资源，不写历练记录；这些行为进入 T3.2 的事务边界。

## T3.2 Boundary

- `AdventureLog` 保存抽取事件、参与学员、投入档、seed、选项和结果；同一账号同一时刻最多一个 PENDING。
- 账号锁与学员锁保护体力、情报状态、余额、库存和声誉；周限量用 `AdventureWeeklyUsage` 的条件递增保护跨账号并发。
- `intel-slip` 先激活账号状态；预览抽到事件但不扣体力，accept 扣体力并展示选项，avoid 结算为已回避且不进入冷却/once 统计。
- T3.2 支持 fixed 与单属性 check；duel、复合检定、讲课、招募、题库入库等由 T3.3–T3.6 接续。

## T3.3 Boundary

- 事件对决复用 `simulateDuel`，不复制答题/精力/tiebreak 算法；玩家作为 HOME，事件对手作为 AWAY。
- 事件对手和四局题目均由 AdventureLog seed 派生；玩家答题侧每局 energy/mindset 变化从 DuelReport rounds 汇总后落库。
- DuelReport 作为 `ContestRecord(type=ADVENTURE, format=DUEL)` 的完整 report 保存，AdventureLog 通过 `contestRecordId` 关联。
- 当前可用 reward 分支包括 G2/R1/L1/L7/P1/C1；R4 的 bank_add、P5 的 win_streak_bonus 及其余题库依赖由 T3.6 接续。

## Verification

- 真实配置导入包含 40 个事件，组内权重按 `stamina_cost + rarity` 合计 100。
- focused tests 覆盖过滤、空稀有度组重归一化、确定性排序、投入档和体力不足。
- T3.2 focused tests 覆盖固定奖励、检定、buff、情报两分支、PENDING 互斥、owner scope 和 HTTP 路由。
- 每个后续 slice 继续保持 M2 的纯函数单测、API 集成测试和 `git diff --check` 质量门。
