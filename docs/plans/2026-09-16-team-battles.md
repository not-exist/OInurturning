# 战斗改为 3~4 人组队出战 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把所有战斗（剧情赛排名制 / 历练出题对决 / PVP 出题对决）从「单人出战」改为「3~4 人组队出战」，这是「为什么要养多名学员」的根本理由。

**Architecture:** 引入「队伍」为一等概念。参与者仍按每人一份独立时间/精力/心态（现有 `simulateParticipant` 语义不变），但**名次改按队伍聚合**：每道题取队内最好一份成绩计入队总分（多人可以撞题，取最好的一份，不重复计分）；NPC 侧同样按相同人数组成 NPC 队参与排名。出题对决改为**每出一题答一题**的 2N 局轮换（N = 队伍人数）。玩家/NPC/事件对手三侧的人数由场景配置决定（剧情 4 / 历练 3 / PVP 由管理员 rosterSize 决定）。

**Tech Stack:** TypeScript、pnpm workspace、Zod（`@oinur/shared` 的 domain schema 是唯一契约源）、Prisma + MySQL、Vitest、Playwright。

**口径已由用户拍板：**

| 决策点 | 结论 |
|---|---|
| 剧情赛队伍结算 | 分工做题，**选题随机、可撞题**；每题计全队最好一份成绩入队总分；NPC 组队同人数；前 8 队通关 |
| 出题对决轮换 | 局数 = 人数×2，每名队员恰好「出一题 + 答一题」 |
| 体力口径 | 每名出战学员各扣全额出战体力 |
| 各场景人数 | 剧情 4 / 历练 3 / PVP 报名时由管理员 rosterSize 决定（3~4） |

**破坏性约定（重要，先确认再动手）：** 战报/report 的 Zod 结构会改（`student` → 队伍、榜单按队伍）。**不为旧战报做兼容层**（项目规则：默认无保留地删）。`ENGINE_VERSION` / `DUEL_ENGINE_VERSION` 需升版，本地/测试库的 `contest_records` 旧记录将无法回放，开发前直接清空该表。

---

## 现状速查（改动落点）

**引擎** `apps/api/src/modules/contest/`
- `engine/ranking.ts:215` `simulateRanking` — `:219` `participants = [input.student, ...input.participants]`，`:224` 玩家恒为 index 0
- `engine/duel.ts:22-27` `DuelState`（每侧单份 energy/mindset）、`:29-32` `sideForRound`（固定 4 局）、`:73-171` `runRound`、`:236-345` `simulateDuel`（`:253-259` 写死 4 局）
- `engine/report.ts:9` `PASS_RANK_MAX=8`、`:104` `validateRankingReport`、`:116-129` `buildContestSummary`
- `npc.ts:60-66` `generateNpcPool`（生成 N 个**个人**）、`:77-110` `generateDuelOpponent`
- `replay.ts:32-119` `buildRankingReplay`（只播 `participants[0]`）、`:121-199` `buildDuelReplay`

**契约** `packages/shared/src/domain/contest.ts`
- `:222-237` `participantSnapshotShape`、`:416-439` `rankingInputShape`（`student` 单数）、`:457-577` `rankingReportShape` + 校验（`:569-576` pass 判定绑死 index 0）、`:581-599` `DuelRoundReport`、`:601-612` `DuelReport`、`:661-690` `duelInputShape`（`home`/`away` 单数）、`:616-623` `RankingSummary`、`:804-901` `BattleReplayEvent`

**三条发起链**
- 剧情：`story/router.ts:8-14`（`roster.length(1)`）→ `story/service.ts:556-771` `enterStoryStage`（`:566` 长度校验、`:591` 单人行锁、`:627` 单人快照、`:700-718` 单人回写）
- 历练：`adventure/service.ts:315-365` `drawAdventure`（单人 `studentId`）、`:522-553` `duelInput`、`:555-567` `playerDuelState`
- PVP：`pvp/registration.ts:108-184` `registerPvp`（`:159` `roster = [participantSnapshot(student)]`）、`pvp/scheduler.ts:89-94` `participant()` 取 `roster[0]`、`:158-173` `inputFor`、`:262-280` `playPending`

**数据** `apps/api/prisma/schema.prisma:123-145` `AdventureLog.studentId`（单人 FK）

**文档（必须同步，否则口径冲突）**
- `docs/systems/progression.md:38-49` §1.3「参赛资格：**单人出战**【定稿】」← **必须先推翻**
- `docs/GAME-DESIGN.md:111-127` §8.1、`:125-138` §8.2、`:231-235` §13.1、`:283-287` §14
- `docs/systems/contest.md:67-103` §3.2 输入结构、`:367` §3.10 NPC 池、`:387` §3.11 结算、`:501-520` §4.1 对决流程
- `docs/data/stages.yaml:19-31` `defaults`（`npc_pool` 语义、缺 `roster_size`）
- `docs/data/events.yaml` 8 处 `duel: { ..., rounds: 4, ... }`（行 95/467/538/656/747/884/961/1019）
- `docs/data/economy.yaml:66-` `onboarding` 的开局金论证已提到「招第 3 人」，本改动后改为叙事一致

---

## Task 1: 文档口径推翻与重写（先于代码，作为后续唯一权威）

**Files:**
- Modify: `docs/systems/progression.md:38-59`（§1.3、§1.4）
- Modify: `docs/GAME-DESIGN.md:111-138`（§8.1、§8.2）、`:231-235`（§13.1）、`:283-287`（§14）

**Step 1: 改写 progression.md §1.3**

原文标题「参赛资格：单人出战【定稿】」改为「**参赛资格：3~4 人组队出战【定稿】**」，并**逐条回应被推翻的 4 条旧理由**：

1. 旧理由 1「多人同场自己抢名次 / 名次奖金套利」→ 现按**队伍**排名，玩家永远是一支队伍，不存在同队竞争；NPC 也组队。
2. 旧理由 2「按题派强项学员是单人制独有策略」→ 保留并放大：现在是「组队覆盖更多主考维度」，且成员可撞题互为兜底。
3. 旧理由 3「战报叙事聚焦一人」→ 改为「以队伍为叙事单位」。
4. 旧理由 4「体力核算最简洁」→ 改为「**每名出战学员各扣全额出战体力**」（§1.4 同步）。

**Step 2: 改 progression.md §1.4 体力表**

表头「每次出战扣减体力（出战学员）」→「**每名出战学员各扣**」；新增一句：五人体力上限下，一次剧情赛消耗 4~8 点队伍总体力，可用体力池随队伍规模同步扩大。

**Step 3: 更新 GAME-DESIGN §8.1/§8.2/§13.1/§14**

- §8.1 第 5 条结算：改为「按**队伍总分**对 NPC **队伍**排名」；新增第 7 条「队伍聚合规则：每题计全队最好一份成绩」。
- §8.2 回合表示例由 `A/B 各出 2 题` 改为「**N 人队 → 2N 局，每人出一题、答一题**」。
- §13.1「每关一场排名制模拟赛（3–4 题）」补「**4 人队伍出战**」。
- §14 PVP 改为「报名锁定 **rosterSize（3~4）** 名学员」。

**Step 4: Commit**

```bash
git add docs/systems/progression.md docs/GAME-DESIGN.md
git commit -m "docs: 参赛资格由单人出战改为 3~4 人组队出战"
```

---

## Task 2: 配置数据与 schema（roster_size / NPC 队语义 / party_size）

**Files:**
- Modify: `docs/data/stages.yaml:19-31`（`defaults`）、全部 33 关的 `npc_pool`
- Modify: `packages/shared/src/config/stages.ts`（`stageConfigSchema`）
- Modify: `docs/data/events.yaml`（8 处 duel 块）
- Modify: `packages/shared/src/config/events.ts`

**Step 1: stages.yaml 加 `roster_size`，并改写 `npc_pool.size` 语义**

`defaults` 增加：

```yaml
roster_size: 4                # 每关出战学员数（玩家队伍与 NPC 队伍同人数）
```

`npc_pool.size` 语义由「**NPC 个人数**」改为「**NPC 队伍数**」（数量级从 24~50 降到 8~14，保证「前 8 队」通关线仍有区分度）。**注释必须写明语义变更**，避免照抄旧注释。（注：重标定后的具体数值在 Task 11 用 `pnpm bal:regress` 校回来。）

**Step 2: `packages/shared/src/config/stages.ts` 的 `stageConfigSchema` 增加 `roster_size`**

`z.number().int().min(3).max(4)`，`defaults` 与单关均可覆盖（沿用现有 `problem_slots` / `npc_pool` 的继承写法）。

**Step 3: events.yaml 8 处 duel 块：删掉写死的 `rounds: 4`，改为 `party_size: 3`**

由「双方人数」推导局数（2N），events schema 同步：删 `rounds`、加 `party_size: 3`。

**Step 4: 运行配置校验确认没写坏**

Run: `pnpm -C apps/api exec tsx -e "import {loadConfig} from './src/config/loader.js'; loadConfig()"` — 期望：无 schema 报错。（若仓库已有更合适的启动自检脚本，用那个。）

**Step 5: Commit**

```bash
git add docs/data/stages.yaml docs/data/events.yaml packages/shared/src/config
git commit -m "config: 关卡加 roster_size、NPC 池改为队伍数、历练对决加 party_size"
```

---

## Task 3: 共享契约团队化（`packages/shared/src/domain/contest.ts`）

**Files:**
- Modify: `packages/shared/src/domain/contest.ts:416-439`（`rankingInputShape`）、`:457-577`（report + pass 校验）、`:661-690`（`duelInputShape`）、`:581-612`（duel report 类型）、`:616-623`（`RankingSummary`）
- Test: `apps/api/tests/contest-contracts.test.ts`

**Step 1: 先写失败测试**（`contest-contracts.test.ts` 追加）

```ts
it('ranking input 必须是若干支 3~4 人的队伍，teams[0] 为玩家队', () => {
  const twoMembers = [snapshot('HOME', 1), snapshot('HOME', 2)];
  expect(() => rankingInputSchema.parse(baseInput({ teams: [{ teamId: 'p', side: 'HOME', userId: 1, members: twoMembers }] })))
    .toThrow();                       // 2 人非法
  expect(() => rankingInputSchema.parse(baseInput({ teams: [] }))).toThrow();  // 空队非法
});

it('同一 seed 与输入产生稳定 snapshotHash', () => {
  expect(simulateRanking(input, seed).snapshotHash).toBe(simulateRanking(input, seed).snapshotHash);
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm -C apps/api test tests/contest-contracts.test.ts` — 期望 FAIL（字段不存在）。

**Step 3: 实现**（要点，非完整代码）

```ts
export const TEAM_SIZE_MIN = 3;
export const TEAM_SIZE_MAX = 4;
const teamMembers = z.array(participantSnapshotSchema).min(TEAM_SIZE_MIN).max(TEAM_SIZE_MAX);

const rankingTeamShape = z.object({
  teamId: z.string().min(1),
  side: z.enum(['HOME', 'NPC']),
  userId: z.number().int().positive().nullable(),
  members: teamMembers,
}).strict();

// RankingInput：删除 student / participants，改为 teams
teams: z.array(rankingTeamShape).min(2)   // 玩家队 + 至少一支 NPC 队
```

- `RankingStanding`：`{ teamIndex, totalScore, rank }`（原 `participantIndex` 作废，**不做别名兼容**）
- `RankingReport`：保留扁平 `participants: ParticipantTimeline[]`（每人一条），新增 `teams`（`teamId/side/userId/memberIndices`），`standings` 按队伍
- `pass` 校验（原 `:569-576`）改为：`teams[0]` 的 rank ≤ 8
- `DuelInput`：`home` / `away` → `{ members }`（同一 `teamMembers` 长度约束），`questions.min(6)`（2×3）
- `DuelRoundReport`：新增 `setterMemberIndex` / `answererMemberIndex`（0-based，用于战报显示谁出题谁答题）
- `RankingSummary.participantCount` 语义改为**队伍数**

**Step 4: 跑测试确认通过**

Run: `pnpm -C apps/api typecheck && pnpm -C apps/api test tests/contest-contracts.test.ts` — 期望 PASS（其它包此时必然报错，属正常；本步只认这个文件）。

**Step 5: Commit**

```bash
git add packages/shared/src/domain/contest.ts apps/api/tests/contest-contracts.test.ts
git commit -m "feat(shared): 战斗契约由单人改为 3~4 人队伍"
```

---

## Task 4: 排名制引擎队伍聚合 + NPC 组队

**Files:**
- Modify: `apps/api/src/modules/contest/engine/ranking.ts:195-244`
- Modify: `apps/api/src/modules/contest/npc.ts:60-66`
- Modify: `apps/api/src/modules/contest/engine/report.ts:116-129`
- Test: `apps/api/tests/ranking-engine.test.ts`

**Step 1: 写失败测试**

```ts
it('同一题被多名队员作答时，只计全队最好的一份成绩', () => {
  const report = simulateRanking(input, seed);
  const team = report.teams[0];
  const perQuestionTotal = bestScorePerQuestion(team);
  expect(teamStanding(report, 0).totalScore).toBe(perQuestionTotal);
  // 且 <= 队员个人得分之和（证明没有重复计分）
  expect(teamStanding(report, 0).totalScore).toBeLessThanOrEqual(sumOfMemberScores(report, team));
});

it('队伍按 totalScore 降序、penalty 升序、teamIndex 升序排名', () => { /* ... */ });
```

**Step 2: 跑测试确认失败**

Run: `pnpm -C apps/api test tests/ranking-engine.test.ts`

**Step 3: 实现**

`ranking.ts`：

- 扁平参与者列表 = `teams.flatMap(t => t.members)`，`simulateParticipant` 的调用与 RNG 子流标签（`npc:${i}`）**保持不变**（key 用全局扁平 index，保证确定性不受影响）。
- 新增 `aggregateTeam(memberResults, questions)`：
  - 对每道题：`best = max(scoreAwarded)`，并列时 `timeSpentMin` 小者胜，再并列取 `memberIndex` 小者
  - `teamTotal += best.scoreAwarded`
  - `teamPenalty += best.verdict === 'AC' ? best.timeSpentMin : 0`（镜像现有「仅 AC 累计罚时」）
- `buildStandings` 改为按队伍（同上排序规则）。
- `pass = isPassingRank(playerTeamRank)`。

`npc.ts`：`generateNpcPool(stage, seed)` → `generateNpcTeams(stage, rosterSize, seed)`，生成 `npc_pool.size` **支** 队伍，每支 `rosterSize` 名；每名成员独立子流 `npc:${teamIndex}:${memberIndex}`，`npcParticipant` 数值逻辑不动。

`report.ts`：`buildContestSummary` 用队伍榜（`participantCount` = 队伍数）。

**Step 4: 跑引擎测试**

Run: `pnpm -C apps/api test tests/ranking-engine.test.ts tests/npc-pool.test.ts` — 期望 PASS。

**Step 5: Commit**

```bash
git add apps/api/src/modules/contest
git commit -m "feat(contest): 排名制改为按队伍聚合，NPC 按同人数组队"
```

---

## Task 5: 回放与报告呈现（`replay.ts` + `report.ts` 版本号）

**Files:**
- Modify: `apps/api/src/modules/contest/replay.ts:32-119`
- Modify: `apps/api/src/modules/contest/engine/report.ts`（`ENGINE_VERSION`）
- Modify: `apps/api/src/modules/contest/engine/duel.ts:18`（`DUEL_ENGINE_VERSION`）
- Test: `apps/api/tests/contest-rng-replay.test.ts`

**Step 1: 写失败测试**

```ts
it('RANKING 回包含全队员的答题事件，并按队员分段', () => {
  const replay = buildBattleReplay(id, teamReport, 't');
  const starts = replay.events.filter((e) => e.type === 'QUESTION_START');
  for (const member of teamReport.teams[0].members) {
    expect(starts.some((e) => e.participantName === member.displayName)).toBe(true);
  }
});
```

**Step 2: 跑失败 → Step 3: 实现**

- `buildRankingReplay`：把「只播 `participants[0]`」改为**遍历玩家队每名成员**（按 `memberIndices` 顺序逐人一段），累加总分改用在 `BATTLE_FINISH` 里一次性给队总分/队名次，避免中途累加错乱。
- `BATTLE_FINISH` 的 `participantCount` 传**队伍数**。
- 升 `ENGINE_VERSION` / `DUEL_ENGINE_VERSION`。

**Step 4:** Run `pnpm -C apps/api test tests/contest-rng-replay.test.ts` PASS
**Step 5:** Commit `feat(contest): 战报回放支持多队员分段与队伍名次`

---

## Task 6: 剧情链 4 人出战

**Files:**
- Modify: `apps/api/src/modules/story/router.ts:8-14`
- Modify: `apps/api/src/modules/story/service.ts:556-771`
- Test: `apps/api/tests/story-coverage.test.ts`（`:196-208` 断言 `roster:[]` 与 `[id,id]` 非法 —— 必须改）

**Step 1: 写失败测试**

```ts
it('roster 人数不等于 stage.roster_size 时进入关卡被拒', async () => {
  await expect(enterStoryStage(userId, 'cspj-1', 0, [a, b, c] )).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(enterStoryStage(userId, 'cspj-1', 0, [a, b, c, a])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // 重复 id
});

it('四名队员的体力/精力/心态各自独立结算落库（不是只回写队长）', async () => {
  const before = await snapshotStudents(roster);
  await enterStoryStage(userId, 'cspj-1', 0, roster, key);
  const after = await snapshotStudents(roster);
  expect(roster.every((id) => after[id].stamina < before[id].stamina)).toBe(true);
});
```

**Step 2:** Run `pnpm -C apps/api test tests/story-coverage.test.ts` FAIL

**Step 3: 实现要点**

- `router.ts`: `roster: z.array(...).min(3).max(4)`（精确人数在服务层按 stage 校验）
- `service.ts` `enterStoryStage`：
  - 校验：`new Set(roster).size === roster.length`、`roster.length === stage.roster_size`，成员均属于本人且 `ACTIVE`
  - **行锁必须按 id 升序**（`roster.slice().sort((a,b)=>a-b)`）避免与其它路径死锁
  - 每人都走 `settle(...)`；**每人都校验** `stamina >= staminaCost`
  - `deriveSeed(userId, sortedRoster.join(','), stageKey, ngLevel, idempotencyKey)`（原用单人 `student.id`）
  - `teams: [ { teamId: 'player', side: 'HOME', userId, members: playerMembers }, ...generateNpcTeams(stage, size, seed) ]`
  - `conductor`：`buildGrowth(report, member, i)` → **循环每名队员**（`:439-511` 已按单人编写，入参加 member + memberIndex，从 `report.participants[idx].attempts` 取数）
  - 回写循环：每名队员各自 `stamina`、`energy`（取自己最后一条 attempt 的 `energyAfter`）、`mindset`
  - `rank` = 队伍榜里 `teams[0]` 的 rank

**Step 4:** Run `pnpm -C apps/api test tests/story.test.ts tests/story-coverage.test.ts tests/story-rewards.test.ts` PASS
**Step 5:** Commit `feat(story): 剧情关卡改为 4 人组队出战`

---

## Task 7: 出题对决引擎改为 2N 局轮换

**Files:**
- Modify: `apps/api/src/modules/contest/engine/duel.ts`（全文）

**Step 1: 写失败测试**（`apps/api/tests/duel-engine.test.ts`）

```ts
it('N 人队产生 2N 局，每名队员恰好出题 1 次、答题 1 次', () => {
  const report = simulateDuel(inputWithMembers([...threeHome], [...threeAway], 6 questions), seed);
  expect(report.rounds).toHaveLength(6);
  const set = countBy(report.rounds, (r) => `${r.setterSide}:${r.setterMemberIndex}`);
  const ans = countBy(report.rounds, (r) => `${r.answererSide}:${r.answererMemberIndex}`);
  for (let i = 0; i < 3; i += 1) {
    expect(set[`HOME:${i}`]).toBe(1);
    expect(ans[`HOME:${i}`]).toBe(1);
    expect(set[`AWAY:${i}`]).toBe(1);
    expect(ans[`AWAY:${i}`]).toBe(1);
  }
});
```

**Step 2:** FAIL → **Step 3: 实现**

- `DuelState`：`energy/mindset/answers` 改为**按 (side, memberIndex)** 索引（`Record<DuelSide, number[]>`）；`scores` 仍是每侧一个。
- 轮换表：第 r 局（1-based），`k = Math.floor((r-1)/2)`，`HOME` 在奇数局出题 ——
  - 出题方成员下标 = `k`
  - 答题方成员下标 = `(k + 1) % N`
  → 每人恰好出 1 题、答 1 题，总 2N 局。
- `runRound` 取 `input[side].members[idx]`，写入该成员的 energy/mindset/answers。
- 局数：`2 * min(home.members.length, away.members.length)`，`questions.min(2*3)=6`；超过的家赛季环保器**保持现有 `suddenDeathQuestion` 逻辑**（改用双方首位成员的题做模板即可）。
- `tieInput`：侧级聚合改为**队员合计**（精力合计 / 出题方题目 quality 合计 / 罚时合计）；`ENERGY` 模式语义由单人余精力改为全队余精力合计。
- `DuelRoundReport` 输出 `setterMemberIndex` / `answererMemberIndex`。

**Step 4:** Run `pnpm -C apps/api test tests/duel-engine.test.ts tests/adventure-duel.test.ts` PASS（adventure 测试会在 Task 8 才全绿，此步允许其失败）
**Step 5:** Commit `feat(contest): 出题对决改为 2N 局、每名队员出一题答一题`

---

## Task 8: 历练链 3 人出战

**Files:**
- Modify: `apps/api/src/modules/adventure/service.ts:315-365`（`drawAdventure`）、`:522-553`（`duelInput`）、`:555-567`（`playerDuelState`）
- Modify: `apps/api/src/modules/adventure/router.ts`（draw 请求体）
- Modify: `apps/api/prisma/schema.prisma:123-145` + 新迁移（给 `AdventureLog` 加 `studentIds Json`）

**Step 1: 写失败测试**

```ts
it('历练对决三名成员均进入 duel 输入，且各自留下自己的精力/心态变化', async () => { /* ... */ });
it('roster 不是 3 人时 draw 被拒', async () => { /* ... */ });
```

**Step 2:** FAIL → **Step 3: 实现**

- `drawAdventure(userId, roster: number[], ...)`：roster 长度 = `party_size`（3）；**每人各扣 `investment` 体力**；`AdventureLog.studentId` 保留为「行动学员（队伍第 1 人）」（once-per-student 冷却、stat_gain 锚点仍用它），新增 `studentIds Json` 记录全队便于未来查询。
- `duelInput`：`home: { members: roster.map(studentParticipant) }`，`away: { members: generateDuelTeam(opponent, seed, partySize, powerMult) }`（NPC 侧同人数，复用 `generateDuelOpponent` 按成员下标派生不同子流）。
- `playerDuelState` 改为 `Record<studentId, { energy, mindset }>`：按各自参与的回合累计。
- Prisma 迁移：`pnpm -C apps/api prisma migrate dev --name adventure_roster`。

**Step 4:** Run `pnpm -C apps/api test tests/adventure.test.ts tests/adventure-duel.test.ts tests/adventure-gaps.test.ts` PASS
**Step 5:** Commit `feat(adventure): 历练对决改为 3 人队伍`

---

## Task 9: PVP 报名 rosterSize 人 + 对局调度

**Files:**
- Modify: `apps/api/src/modules/pvp/router.ts`（register 请求体）
- Modify: `apps/api/src/modules/pvp/registration.ts:108-184`
- Modify: `apps/api/src/modules/pvp/scheduler.ts:89-94`、`:158-173`
- Test: `apps/api/tests/pvp-registration.test.ts`（`:84` 断言 `roster[0].displayName`）、`pvp-scheduler.test.ts`、`pvp-coverage.test.ts:105-107`

**Step 1: 写失败测试**：报名人数 ≠ `tournament.config.rosterSize` 被拒；对局能正常产出 2N 局战报。

**Step 2:** FAIL → **Step 3: 实现**

- `registerPvp(userId, tournamentId, studentIds: number[], ...)`：按 `tournament.config.rosterSize`（缺省 3，范围 3~4）校验人数、去重、归属、ACTIVE；`roster` 存该数组。
- `scheduler.ts`：删 `participant()`（`roster[0]`）→ `members(row, side)`；`inputFor` 造两侧 `{ members }`；
- **预制题配额**：原来「每侧至多 2 道」改为「每侧至多 `rosterSize` 道」（每人一道自己的题），`questionFor` 的实例 id 与 index 映射按新局数重排，`generatedQuestion` 兜底逻辑不变。
- `awardProblemReputation` 不依赖单人，无需改。

**Step 4:** Run `pnpm -C apps/api test tests/pvp-registration.test.ts tests/pvp-scheduler.test.ts tests/pvp-coverage.test.ts` PASS
**Step 5:** Commit `feat(pvp): 报名锁定 rosterSize 名学员，对局按队伍进行`

---

## Task 10: 前端三处多选与战报展示

**Files:**
- Modify: `apps/web/src/features/story/StoryPage.tsx:26,72-84,112-150`
- Modify: `apps/web/src/features/adventure/AdventurePage.tsx:150,203,211`
- Modify: `apps/web/src/features/pvp/PvpPage.tsx:27,107,171-175`
- Modify: `apps/web/src/lib/hooks.ts:1098-1120`（`roster: number[]` 放开长度）
- Modify: `apps/web/src/features/records/BattleReplay.tsx:148,265,410`、`RecordReportPage.tsx`

**Step 1: 实现**（先不要为前端写单测，冒烟即可）

- 抽一个共享的 `RosterPicker`（学员多选卡片：头像/姓名/V/精力/体力，选中高亮，显示 `已选 3/4`），三处复用（DRY）。
- 剧情：默认预选前 4 名学员；未满 4 人时「进入」按钮禁用并提示需补人。
- 历练：3 人；PVP：按 `tournament.config.rosterSize`。
- `BattleReplay.tsx`：`BATTLE_START` 的 `homeName` 改为队伍名反射（如「我方 4 人队 · 张三/李四/…」）；DUEL 的 `ROUND_START` / `ROUND_RESULT` 展示「出题：X → 答题：Y」（用新增的 memberIndex 取成员名）。
- `BattleWaiting` / skip 控件已有，无需改。

**Step 2:** Run `pnpm -C apps/web typecheck && pnpm -C apps/web lint` PASS
**Step 3:** Commit `feat(web): 出战阵容改为多人选择，回放与战报展示队伍成员`

---

## Task 11: 测试更新、补核心语义测试、跑平衡回归

**Files:**
- Test: `apps/api/tests/` 下所有涉及 roster/engine 的文件
- Run: `pnpm bal:regress`、`pnpm sim:economy`

**Step 1: 更新存量断言**（跟着 Ticket 改，不多写一行）

`story-coverage.test.ts:196-208`、`pvp-registration.test.ts:84`、`pvp-coverage.test.ts:105-107`、`overview.test.ts:210`、`contest-kernel / report-determinism / m2-golden / journey-full` 中的 `roster: [id]` 改为 4 人。

**Step 2: 保留性新增（只补「核心语义 + 高概率回归」，按 AGENTS.md #8 不写垃圾测试）**

1. **撞题只计一份**：同一题多人作答，队分取最好一份，且 ≤ 个人之和（Task 4 已写）
2. **2N 局轮换每人出/答各一次**（Task 7 已写）
3. **四人各自结算落库，不能只回写队长**（Task 6 已写）— 高概率回归
4. **人数/去重校验**：2 人、5 人、重复 id 均被拒（Task 6/8/9 已写）
5. **确定性**：同 seed + 同输入两次跑出相同 `snapshotHash` 与相同战报（Task 3 已写）

> 不写：判断题于概率/浮点边框此类「不可能回归」的断言。

**Step 3: 跑全量**

Run: `pnpm typecheck && pnpm lint && pnpm test` — 期望全绿。

**Step 4: 平衡回归（NPC 池语义变更后必跑）**

Run: `pnpm bal:regress` — 对照 8 章节关卡的通关率/平均分，**重标定 `stages.yaml` 各关 `npc_pool.size`（现为队伍数）**，使各章难度曲线与改动前相当（Task 2 预留的数值在此定稿）。

Run: `pnpm sim:economy` — 检查多人参战后周收支比仍在 `[0.90, 1.15]`：注意单人**体力上限与回复速率不变**，但一次剧情赛的**队伍总体力消耗**变大了，必要时在 `economy.yaml` 调整 `story.stamina_cost`（唯一权威，不得在代码里硬编码）。

**Step 5:** Commit `test: 战斗改队伍后的测试更新与数值重标定`

---

## Task 12: e2e 更新与冒烟

**Files:**
- Modify: `tests/e2e/specs/story.spec.ts`、`adventure.spec.ts`、`pvp.spec.ts`、`full-journey.spec.ts`、`overview.spec.ts:47`

**Step 1:** 把对应页面的单选 `select`（如 `story-student`）改为多选交互（点 `RosterPicker` 卡片），账号 seeding 需保证有 ≥4 名 ACTIVE 学员。

**Step 2:** Run `pnpm e2e:seed && pnpm e2e` — 期望全绿。

**Step 3:** Commit `test(e2e): 出战阵容改为多选并补齐参战学员`

---

## 执行方式建议

Task 1→2→3→5 是串行依赖（口径 → 数据 → 契约 → 呈现）；**Task 6（剧情）、Task 7→8（对决/历练/PVP）、Task 10（前端）在 Task 5 之后基本解耦**，可用 Agent Teams 三条并行流推进，由负责人统一集成并在 Task 11/12 做全量与 e2e 验证。
