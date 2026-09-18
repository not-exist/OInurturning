# 战斗回放并行展示 — 实施计划

> 接续 PR #10（团队战斗）的工作。PR #10 将单人出战改为 3~4 人组队出战，但战斗回放动画仍然是
> 线性的：看完队员 A 的全部题目 → 再看队员 B 的全部题目 → …。本次改动使回放界面同时展示
> 所有队员的战斗进展。

## 1. 问题分析

### 1.1 现状

| 层 | 文件 | 问题 |
|---|---|---|
| 回放生成 | `apps/api/src/modules/contest/replay.ts` | `buildRankingReplay` 按队员顺序（`for timeline of playerTimelines`）逐人串行生成事件，即 m0 全部 → m1 全部 → m2 全部 |
| 事件契约 | `packages/shared/src/domain/contest.ts` | `BattleReplayEvent` 各变体只携带 `participantName`（字符串），无 `memberIndex`，前端无法可靠地按队员路由事件 |
| 回放 UI | `apps/web/src/features/records/BattleReplay.tsx` | 单游标 + 单 `LiveEvent` 组件，一次只渲染一个事件 |
| 战报详情 UI | `apps/web/src/features/records/RecordReportPage.tsx` | `RankingReport` 已按队员分表（这部分没问题），但回放动画入口前的等待/过渡仍只是单面板 |

### 1.2 目标

- 排名赛回放：以 N 列面板并排展示每位队员的实时答题状态，事件按"题号轮转"交错推进。
- 出题对决回放：保留逐局顺序，但增强显示当前出题者/答题者的队员身份（已有 setterName/answererName，可复用）。
- 静态战报：已有的按队员分表展示不变。

## 2. 设计方案

### 2.1 事件流交错策略（排名赛）

**核心思路**：把事件从"按队员交错"改为"按题号轮转"。

当前事件流：
```
BATTLE_START
  → m0_Q0 [START, SUB×k, RESULT]
  → m0_Q1 [START, SUB×k, RESULT]
  → m0_Q2 ...
  → m1_Q0 [START, SUB×k, RESULT]
  → m1_Q1 ...
  → m2_Q0 ...
BATTLE_FINISH
```

交错后的事件流：
```
BATTLE_START
  ── Phase 0（第 1 题）──
  → m0_Q0 [START, SUB×k, RESULT]
  → m1_Q0 [START, SUB×k, RESULT]
  → m2_Q0 [START, SUB×k, RESULT]
  ── Phase 1（第 2 题）──
  → m0_Q1 [START, SUB×k, RESULT]
  → m1_Q1 [START, SUB×k, RESULT]
  → m2_Q1 [START, SUB×k, RESULT]
  ...
BATTLE_FINISH
```

每位队员在每个 phase 内的事件串（START → SUBMISSIONs → RESULT）保持原有顺序，只是 phase 之间
的排列从"全部 m0 再全部 m1"改为"按题号轮转"。这样每名队员的面板在同一题号区间内被连续更新，
自然形成"并行推进"的观感。

### 2.2 事件契约变更

为 `BattleReplayEvent` 的排名赛相关变体增加 `memberIndex` 字段：

| 事件变体 | 新增字段 | 说明 |
|---|---|---|
| `BATTLE_START` | — | 不需要 |
| `QUESTION_START` | `memberIndex: number` | 队内成员下标（0-based） |
| `SUBMISSION` | `memberIndex: number` | 同上 |
| `QUESTION_RESULT` | `memberIndex: number` | 同上 |
| `ROUND_START` | — | 出题对决已有 `setterName`/`participantName`，不需要 memberIndex |
| `ROUND_RESULT` | — | 同上 |
| `TIEBREAK` | — | 不需要 |
| `BATTLE_FINISH` | — | 不需要 |

同时为 `QUESTION_START` / `QUESTION_RESULT` 补充 `memberName: string`（冗余但从属事件的
participantName 可能不一致；保持向后兼容：前端优先读 `memberName`，fallback 到 `participantName`）。

> **向后兼容**：`memberIndex` 为 `number | undefined`（可选），旧回放数据缺失时前端 fallback 到顺序推断。

### 2.3 前端回放 UI 改造

#### 2.3.1 多面板布局

```
┌───────────────────────────────────────────────────────┐
│  BATTLE_START 横幅（队伍名 VS 队伍名）                │
├─────────────┬─────────────┬─────────────┬─────────────┤
│  成员 0 面板 │  成员 1 面板 │  成员 2 面板 │  成员 3 面板 │
│  ┌─────────┐│  ┌─────────┐│  ┌─────────┐│  ┌─────────┐│
│  │ 头像/名  ││  │ 头像/名  ││  │ 头像/名  ││  │ 头像/名  ││
│  │ 当前题号 ││  │ 当前题号 ││  │ 当前题号 ││  │ 当前题号 ││
│  │ 提交历史 ││  │ 提交历史 ││  │ 提交历史 ││  │ 提交历史 ││
│  │ 判定结果 ││  │ 判定结果 ││  │ 判定结果 ││  │ 判定结果 ││
│  │ 得分/精力 ││  │ 得分/精力 ││  │ 得分/精力 ││  │ 得分/精力 ││
│  └─────────┘│  └─────────┘│  └─────────┘│  └─────────┘│
├─────────────┴─────────────┴─────────────┴─────────────┤
│  进度条 · 播放/暂停 · 速度 · 跳过 · 队伍总分         │
├───────────────────────────────────────────────────────┤
│  BATTLE_FINISH 结算面板（排名、总分、奖励）            │
└───────────────────────────────────────────────────────┘
```

- 排名赛：N 列网格（`grid-cols-3` 或 `grid-cols-4`，按实际队员数自适应）。
- 出题对决：保留现有的单面板逐局展示（对决本身是回合制，无需多面板）。
- BATTLE_START / BATTLE_FINISH 事件仍为全宽显示。

#### 2.3.2 每个成员面板的状态模型

```ts
interface MemberPanelState {
  memberIndex: number;
  displayName: string;
  currentQuestion: number | null;     // 当前题号（0-based）
  currentPhase: 'THINKING' | 'SUBMITTING' | 'DONE' | 'IDLE';
  submissions: { attemptNo: number; verdict: string }[];
  totalScore: number;
  energyAfter: number;
  focusAfter: number;
  mindsetAfter: number;
  notes: string[];
  verdict: string | null;             // 当前题的最终判定
}
```

事件到达时按 `memberIndex` 路由到对应面板并更新状态。

#### 2.3.3 组件拆分

| 组件 | 职责 |
|---|---|
| `BattleReplay` | 顶层回放容器；管理 cursor、paused、speed；根据 `replay.format` 选择渲染模式 |
| `RankingParallelReplay` | **新增**；排名赛并行回放；接收 `events` 和 `replay`，管理 per-member 状态 |
| `MemberPanel` | **新增**；单个队员面板；接收 `MemberPanelState`，渲染该队员当前进度 |
| `DuelSequentialReplay` | 从现有 `BattleReplay` 中拆出的对决回放逻辑（可选重构，非必须） |
| `BattleWaiting` | 不变 |

### 2.4 出题对决回放增强（可选）

对决回放保留逐局顺序，但在 `ROUND_START` / `ROUND_RESULT` 事件面板中增加队伍阵容概览条，
高亮当前出题者和答题者。这个增强较简单，可以一并做也可以后续跟进。

## 3. 实施步骤

### Step 1: 共享契约 — 事件增加 `memberIndex`

**文件**：`packages/shared/src/domain/contest.ts`

- `QUESTION_START` 变体增加 `memberIndex: z.number().int().nonnegative().optional()`
- `SUBMISSION` 变体增加 `memberIndex: z.number().int().nonnegative().optional()`
- `QUESTION_RESULT` 变体增加 `memberIndex: z.number().int().nonnegative().optional()`

> 使用 optional 保持向后兼容。

### Step 2: 回放生成 — 交错事件流

**文件**：`apps/api/src/modules/contest/replay.ts`

重写 `buildRankingReplay`：

```ts
function buildRankingReplay(recordId, report, title): BattleReplay {
  const events = [];
  let seq = 0;
  const playerTimelines = report.participants.slice(0, playerMembers.length);
  const questionCount = maxAttemptsAcrossMembers;

  events.push(BATTLE_START ...);

  // 按题号轮转
  for (let qi = 0; qi < questionCount; qi++) {
    for (let mi = 0; mi < playerTimelines.length; mi++) {
      const timeline = playerTimelines[mi];
      const attempt = timeline.attempts[qi];
      if (!attempt) continue;

      events.push({ type: 'QUESTION_START', memberIndex: mi, ... });
      for (const sub of attempt.resolution.submissions) {
        events.push({ type: 'SUBMISSION', memberIndex: mi, ... });
      }
      events.push({ type: 'QUESTION_RESULT', memberIndex: mi, ... });
    }
  }

  events.push(BATTLE_FINISH ...);
  return { ... };
}
```

### Step 3: 前端 — 并行回放组件

**文件**：`apps/web/src/features/records/BattleReplay.tsx`

1. 新增 `MemberPanelState` 接口和 `MemberPanel` 组件。
2. 新增 `RankingParallelReplay` 组件：
   - 从 replay 事件中提取队员元信息（BATTLE_START 时的 homeName 解析或事件流中收集 memberIndex/displayName 映射）
   - 维护 `memberStates: Map<number, MemberPanelState>`
   - cursor 推进时，按事件的 `memberIndex` 路由到对应面板
   - 渲染 N 列网格 + 队伍总分条 + 控制栏
3. `BattleReplay` 顶层根据 `replay.format` 分派：`RANKING` → `RankingParallelReplay`，`DUEL` → 现有逻辑（或未来 `DuelSequentialReplay`）。
4. `BATTLE_START` 和 `BATTLE_FINISH` 事件仍为全宽横幅，插入到网格上方/下方。

### Step 4: 向后兼容 — 旧回放 fallback

在 `RankingParallelReplay` 中，如果事件缺少 `memberIndex`，按事件顺序为同一队员累加推断：
维护 `currentMember = 0`，每当遇到 `QUESTION_RESULT` 且下一个事件是不同队员的 `QUESTION_START` 时递增。
实际上更简单的方案：如果检测到无 `memberIndex` 的事件流，fallback 到原有的单面板 `LiveEvent` 渲染。

### Step 5: 测试

- 单元测试：验证交错后事件流的 `memberIndex` 分配与顺序。
- 视觉验证：在浏览器中播放排名赛回放，确认多面板同步推进。
- 回放确定性：同一 seed 的回放事件序列应完全一致（seq 号、durationMs、memberIndex 均确定性）。

## 4. 影响范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `packages/shared/src/domain/contest.ts` | 修改 | 事件变体增加 `memberIndex`（可选） |
| `apps/api/src/modules/contest/replay.ts` | 重写 | `buildRankingReplay` 改为按题号轮转交错 |
| `apps/web/src/features/records/BattleReplay.tsx` | 大幅修改 | 新增并行回放组件与成员面板 |
| `apps/web/src/features/records/RecordReportPage.tsx` | 微调 | 如需调整回放后的过渡逻辑 |
| 测试文件 | 更新 | 回放事件测试用例适配 |

## 5. 不变项

- 引擎（`ranking.ts`、`duel.ts`、`solve.ts`）：不受影响，报告数据不变。
- 静态战报页面（`RecordReportPage` 的 RankingReport/DuelReport 组件）：已按队员分表，不需要改动。
- DUEL 回放：保留逐局顺序展示，不做多面板改动（对决本身是回合制）。
- API 路由/DB schema：不受影响。
- 部署配置：不受影响。

## 6. 原子提交计划

1. ✅ `feat(shared): 回放事件增加 memberIndex 字段` — `0e001fa`
2. ✅ `feat(contest): 排名赛回放按题号轮转交错` — `eaf2196`
3. ✅ `feat(web): 排名赛回放改为多面板并行展示` — `c772d67`
4. ✅ `test(contest): 覆盖排名赛回放 memberIndex 与题号轮转交错` — `408066a`
