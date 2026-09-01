# M3 历练与学院实现计划

**Goal:** 在 M2 比赛内核之上实现可重复、可审计的历练事件闭环，并继续接入高级学院与账号题库。

**Authority:** `docs/systems/gameplay.md`、`docs/data/events.yaml`、`docs/data/economy.yaml`、`docs/systems/student.md`。

## Slice Order

1. T3.1：事件 schema、六文件配置导入、引用/权重语义校验、确定性事件抽取器。
2. T3.2：历练记录与事件状态持久化，体力扣减、情报预览/回避、choice/outcome 结算。
3. T3.3：事件中的 duel outcome 接入 M2 对决内核并写入 `ContestRecord`。
4. T3.4–T3.5：高级学院候选池复用 M1 招募池，补讲课门槛、每日额度、报酬与强接风险。
5. T3.6：出题行动、质量评级与 `ProblemLibraryEntry` 入库，复用专项训练和未来 PVP 的题库契约。

## T3.1 Boundary

- `CONFIG.events` 是冻结的内存只读目录；数据库只承载导入审计与回滚所需 payload。
- 抽取器是纯函数，只接受投入档、当前玩家状态、事件历史和 RNG，不访问数据库或时钟。
- 过滤顺序为体力可用性、精确投入层、requirements、冷却、一次性/周限量，再按 rarity 与组内 weight 抽取。
- T3.1 不结算 rewards，不扣资源，不写历练记录；这些行为进入 T3.2 的事务边界。

## Verification

- 真实配置导入包含 40 个事件，组内权重按 `stamina_cost + rarity` 合计 100。
- focused tests 覆盖过滤、空稀有度组重归一化、确定性排序、投入档和体力不足。
- 每个后续 slice 继续保持 M2 的纯函数单测、API 集成测试和 `git diff --check` 质量门。
