# M2 Contest Simulation and Story Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 学员养成基础上实现确定性比赛模拟内核、排名赛与出题对决、8 章 33 关剧情模式、战报持久化、首通奖励与 NG+。

**Architecture:** 将比赛逻辑拆为不读数据库、不读时钟的纯函数引擎：`(snapshot, seed) -> report`。API 层负责配置导入、学员/题目快照、鉴权、事务、幂等、战报落库和奖励发放；shared 层提供跨 API/web 的快照、战报和 DTO 类型。剧情与未来 PVP/历练共用 `ContestRecord`，用 `format` 区分 RANKING/DUEL，用 `type` 区分 STORY/PVP/ADVENTURE。

**Tech Stack:** pnpm workspace、Node.js >=22、TypeScript strict + NodeNext、Express 5、Prisma 6、MariaDB/MySQL、Zod、YAML、Vitest、Supertest、React 19、React Router 7、TanStack Query、Tailwind 4。

**Spec:** `docs/systems/contest.md`, `docs/systems/progression.md`, `docs/data/problems.yaml`, `docs/data/stages.yaml`, `docs/data/economy.yaml`, `docs/TECH-DESIGN.md`, `docs/ROADMAP.md`

## Global Constraints

- 分支为 `m2-contest-story`；不使用 Docker 作为开发或测试前置，测试使用本地 MariaDB `127.0.0.1:3306`。
- strict + NodeNext；API 相对导入必须带 `.js`，web 侧按现有 bundler resolution 约定。
- `docs/systems/contest.md` 是比赛模拟规则的权威；`docs/systems/progression.md` 是剧情流程、奖励和 NG+ 的权威；冲突必须在代码或注释中明确采用的裁定。
- 数值只来自 `docs/data/*.yaml` 或已有权威系统文档；代码不得复制可调平衡常数。
- 模拟器为纯函数，显式接收 seed，不使用 `Math.random()`、数据库、网络或当前时间；同输入同 seed 产生同 JSON 结构和值。
- 所有体力、金钱、道具、进度和奖励变更在 Prisma transaction 内完成；重复请求必须幂等，不得重复发放首通奖励。
- 每个任务先写失败测试，再写最小实现；任务结束运行定向测试、`pnpm -C apps/api typecheck` 和 `pnpm lint`，通过后再提交 Conventional Commit（提交需带仓库现行 trailer）。
- M1 的 `/api/problems` 仍表示用户的 `ProblemLibraryEntry`；M2 的 `problems.yaml` 是配置题目模板，不得混淆两个 API 资源。
- 共享报告以 `contest.md` §3.14/§4.8 的最终形状为准，并保留 `reportVersion`, `engineVersion`, `rngVersion`, `seed`, `snapshotHash` 等可审计字段；TECH-DESIGN 中的旧 DTO 仅作为兼容参考。

---

### Task 1: Shared Contest Contracts and Configuration Schemas

**Files:**
- Create: `packages/shared/src/config/problems.ts`
- Create: `packages/shared/src/config/stages.ts`
- Create: `packages/shared/src/domain/contest.ts`
- Create: `packages/shared/src/domain/story.ts`
- Modify: `packages/shared/src/config/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/config/*.test.ts` or `apps/api/tests/config-m2-schema.test.ts` following the existing test layout

**Interfaces:**
- Consumes: Existing `AbilityKey`/dimension enums and M1 config export conventions.
- Produces: `problemConfigSchema`, `stagesConfigSchema`, `ProblemTemplate`, `ProblemTrait`, `StageConfig`, `RankingInput`, `DuelInput`, `RankingReport`, `DuelReport`, `ContestReport`, `ContestSummary`, `StoryOverview`, `StoryProgressView`.

- [ ] **Step 1: Write failing schema tests**

Cover the actual YAML shapes: top-level `version`, `updated`, `conventions`, `severity_ladder`, `traits`, `templates` for problems; chapter/stage records, `problem_slots`, `npc_pool`, `first_clear`, `milestone`, `full_clear`, and `ng_plus` for stages. Assert valid fixture data parses, lowercase config dimensions normalize only at the adapter boundary, missing required fields fail, invalid trait references fail structurally, and malformed reward entries fail with a path.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm test -- packages/shared/src/config` or the exact Vitest file selected by the repository layout.
Expected: FAIL because the M2 schemas and contracts do not exist.

- [ ] **Step 3: Define the shared contracts**

Use discriminated unions for `ContestReport` (`format: 'RANKING' | 'DUEL'`), explicit `QuestionSnapshot`, `ParticipantSnapshot`, attempt/timeline entries, standings, duel rounds, rewards, and growth. Define `StoryStageKey = string`, `ngLevel: number`, and DTOs as JSON-safe values. Keep internal simulator inputs separate from API response views so database payloads cannot accidentally expose mutable Prisma records.

- [ ] **Step 4: Implement and export Zod schemas**

Model the fields present in the YAML files without inventing a second config format. Export inferred types and add the new modules to both config and package root exports.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm test -- <focused-files> && pnpm typecheck`.
Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config packages/shared/src/domain packages/shared/src/index.ts
git commit -m "feat(shared): add M2 contest and story contracts"
```

---

### Task 2: Deterministic RNG and Shared Solving Kernel (T2.1)

**Files:**
- Create: `apps/api/src/modules/contest/engine/rng.ts`
- Create: `apps/api/src/modules/contest/engine/solve.ts`
- Create: `apps/api/src/modules/contest/engine/models.ts`
- Test: `apps/api/tests/contest-rng.test.ts`
- Test: `apps/api/tests/solve-kernel.test.ts`

**Interfaces:**
- Consumes: `mulberry32` from `apps/api/src/lib/rng.ts`, `QuestionSnapshot`, `ParticipantSnapshot`, and constants/formulas from `contest.md`.
- Produces: `deriveSeed(...parts: (string | number)[]): number`, `estimateSolveTime(input): number`, `focusAfterAttempt(input): number`, `energyCost(input): number`, `resolveAttempt(input, rng): AttemptResolution`, and `solveQuestion(input, rng): QuestionAttempt`.

- [ ] **Step 1: Write failing boundary tests**

Test identical seeds produce identical random streams; different stream labels do not consume each other; zero gaps, maximum gaps, zero energy, full focus, mindset bounds, and clock exhaustion. Add the documented numerical anchor for `dim=50, thinking=48, code=52`, question demand/thought/code values and `focus=0`. Cover AC, WA, TLE, SKIP and `UNFINISHED` as distinct outcomes, including no negative energy and no time beyond the configured duration.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- apps/api/tests/contest-rng.test.ts apps/api/tests/solve-kernel.test.ts`.
Expected: FAIL because the engine modules do not exist.

- [ ] **Step 3: Implement deterministic stream derivation**

Use unsigned 32-bit arithmetic and the existing mulberry32 implementation. Derive independent labeled streams from a stable integer hash; never use object iteration order or wall-clock values. Export `RNG_VERSION` so reports can identify the stream algorithm.

- [ ] **Step 4: Implement the pure solving functions**

Translate contest.md §§3.3–3.6 and §3.9 into small functions: three-gap sigmoid estimate, noise, focus accumulation and speed-up, code-gap energy cost, hook modifiers, AC probability, submission retry flow, WA/TLE distinction, SKIP on insufficient energy, and UNFINISHED on duration exhaustion. Clamp every public result at the documented bounds and return intermediate values needed for a timeline entry.

- [ ] **Step 5: Run focused tests and inspect deterministic JSON**

Run: `pnpm test -- apps/api/tests/contest-rng.test.ts apps/api/tests/solve-kernel.test.ts`.
Expected: PASS, including repeated invocation deep equality.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contest/engine apps/api/tests/contest-rng.test.ts apps/api/tests/solve-kernel.test.ts
git commit -m "feat(api): add deterministic contest solving kernel"
```

---

### Task 3: Ranking Simulator and Contest Report Builder (T2.2)

**Files:**
- Create: `apps/api/src/modules/contest/engine/ranking.ts`
- Create: `apps/api/src/modules/contest/engine/report.ts`
- Test: `apps/api/tests/ranking-engine.test.ts`
- Test: `apps/api/tests/report-determinism.test.ts`

**Interfaces:**
- Consumes: Task 1 report contracts and Task 2 solving functions.
- Produces: `simulateRanking(input: RankingInput, seed: number): RankingReport`, `buildContestSummary(report): ContestSummary`, and a stable report serialization/hash helper.

- [ ] **Step 1: Write failing simulator tests**

Use a small fixed question set and two to eight participants. Assert participant ordering, question selection, timeline verdicts, score totals, rank tie handling, pass rank `<= 8`, and that a stronger participant improves expected rank across a deterministic multi-seed sample. Assert that two calls with the same input and seed produce byte-equivalent serialized reports.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- apps/api/tests/ranking-engine.test.ts apps/api/tests/report-determinism.test.ts`.
Expected: FAIL because `simulateRanking` is not implemented.

- [ ] **Step 3: Implement question instantiation and participant simulation**

Instantiate the supplied question snapshots, apply participant/trait hooks through the kernel, run questions in the documented AI selection order, stop on duration/energy limits, and record every attempt needed to reproduce the result. Keep all participant state local to the function and preserve input snapshots unchanged.

- [ ] **Step 4: Implement standings and report validation**

Sort by documented score/time tie rules, assign stable ranks, calculate pass state, fill report metadata (`reportVersion`, `engineVersion`, `rngVersion`, `seed`, `snapshotHash`), validate the report with shared Zod before returning it, and build the compact summary.

- [ ] **Step 5: Run deterministic and statistical tests**

Run: `pnpm test -- apps/api/tests/ranking-engine.test.ts apps/api/tests/report-determinism.test.ts`.
Expected: PASS with stable golden JSON and monotonicity sample within the test tolerance.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contest/engine/ranking.ts apps/api/src/modules/contest/engine/report.ts apps/api/tests/ranking-engine.test.ts apps/api/tests/report-determinism.test.ts
git commit -m "feat(api): add deterministic ranking simulator"
```

---

### Task 4: Duel Simulator (T2.3)

**Files:**
- Create: `apps/api/src/modules/contest/engine/duel.ts`
- Test: `apps/api/tests/duel-engine.test.ts`

**Interfaces:**
- Consumes: Task 2 answer simulation, Task 3 report metadata helpers, premade-question replacement inputs.
- Produces: `simulateDuel(input: DuelInput, seed: number): DuelReport` and `resolveTiebreak(input): WinnerSide`.

- [ ] **Step 1: Write failing duel tests**

Cover four alternating setter rounds, setter/answerer orientation, normal scoring, `qualityRuleOn` awarding +2 to the setter when the opponent fails, premade question selection, and all four tiebreak modes: sudden death, energy, quality, and friendly. Assert no participant is asked their own submitted question and that a fixed seed gives identical rounds and winner.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test -- apps/api/tests/duel-engine.test.ts`.
Expected: FAIL because the duel simulator is absent.

- [ ] **Step 3: Implement alternating rounds and scoring**

Build four rounds from the supplied home/away snapshots, delegate answer resolution to the shared kernel, award points according to contest.md, and include the question source and premade entry id in the report. Keep the quality-rule switch explicit in input.

- [ ] **Step 4: Implement tiebreak dispatch**

For a tied four-round score, dispatch only the selected enum. Ensure each branch is deterministic and returns DRAW only for the documented friendly outcome. Add any sudden-death extra round as round 5+.

- [ ] **Step 5: Validate report and run tests**

Run: `pnpm test -- apps/api/tests/duel-engine.test.ts`.
Expected: PASS for all scoring and tie branches.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contest/engine/duel.ts apps/api/tests/duel-engine.test.ts
git commit -m "feat(api): add deterministic duel simulator"
```

---

### Task 5: Import Problems and Stages Configurations (T2.4)

**Files:**
- Modify: `apps/api/src/config/loader.ts`
- Modify: `apps/api/src/config/semantic.ts`
- Modify: `apps/api/src/config/index.ts` if present
- Modify: `apps/api/prisma/schema.prisma` for complete `ConfigProblem`/`ConfigStage` payload models and metadata
- Create: `apps/api/tests/config-m2-import.test.ts`
- Create or modify: `apps/api/tests/fixtures/config/problems.yaml`
- Create or modify: `apps/api/tests/fixtures/config/stages.yaml`
- Create: `apps/api/src/modules/contest/npc.ts`
- Test: `apps/api/tests/npc-pool.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 3 ranking input types.
- Produces: `CONFIG.problems`, `CONFIG.stages`, `getProblemTemplate(id)`, `getStageConfig(stageKey)`, and `generateNpcPool(stage, seed): ParticipantSnapshot[]`.

- [ ] **Step 1: Add failing importer and NPC tests**

Assert all 34 problem templates and 33 stages load from the real YAML, invalid trait/template references fail in one aggregated startup error, source-hash idempotence remains intact, stale active rows become deprecated, and the NPC pool has the configured size and stable output for a seed.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test -- apps/api/tests/config-m2-import.test.ts apps/api/tests/npc-pool.test.ts`.
Expected: FAIL because the loader still imports only talents/items/economy and `CONFIG` has no M2 sections.

- [ ] **Step 3: Extend schema, loader, and reconciliation**

Add `problems` and `stages` to the config bundle, parse the actual top-level YAML shapes, run cross-file semantic checks, include all five files in the source hash, upsert/deprecate rows in one transaction, and preserve the existing M1 idempotent skip behavior. Update test fixtures and health `configVersion` behavior without changing the M1 user-problem endpoint.

- [ ] **Step 4: Implement NPC generation**

Use stage NPC configuration and explicit RNG streams to generate stable participant snapshots. Keep NPC generation independent of Prisma and avoid storing generated NPCs as user students.

- [ ] **Step 5: Run tests, typecheck and migration validation**

Run: `pnpm test -- apps/api/tests/config-m2-import.test.ts apps/api/tests/npc-pool.test.ts && pnpm -C apps/api typecheck`.
Expected: PASS; migration SQL applies cleanly to the local test database.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config apps/api/src/modules/contest/npc.ts apps/api/prisma apps/api/tests
git commit -m "feat(api): import M2 contest and story configuration"
```

---

### Task 6: Contest Persistence Schema and Story Progress API (T2.5 foundation)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: Prisma migration via `pnpm -C apps/api prisma migrate dev --name contest_records_story_progress`
- Modify: `packages/shared/src/domain/story.ts`
- Create: `apps/api/src/modules/contest/repository.ts`
- Create: `apps/api/tests/contest-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 report/overview contracts and Task 5 config bundle.
- Produces: `ContestRecord` and `StoryProgress` Prisma models; `createContestRecord`, `getContestRecordForUser`, `getStoryProgress`, `upsertStoryProgress`, and unique idempotency constraints.

- [ ] **Step 1: Write failing persistence tests**

Test record ownership, JSON report/summary storage, snapshot hash storage, `(userId, type, createdAt)` indexes, story progress uniqueness by `(userId, ngLevel, stageKey)`, idempotency key uniqueness, and non-owner access returning not found rather than another user's report.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test -- apps/api/tests/contest-repository.test.ts`.
Expected: FAIL because M2 models/repository are absent.

- [ ] **Step 3: Add Prisma enums and models**

Add `ContestType`, `ContestFormat`, `ContestRecord`, and `StoryProgress` with JSON fields for frozen input snapshot, report, rewards, and summary. Add owner indexes, unique idempotency key, and cascade behavior consistent with M1 account deletion rules. Keep future PVP/adventure relationships nullable and out of this task.

- [ ] **Step 4: Generate and apply migration**

Run: `pnpm -C apps/api prisma migrate dev --name contest_records_story_progress && pnpm -C apps/api prisma generate`.
Expected: migration and generated client succeed against the local development database.

- [ ] **Step 5: Implement repository methods and tests**

Use typed JSON conversion at the repository boundary, scope every read by `userId`, and make duplicate idempotency inserts return the existing record. Run: `pnpm test -- apps/api/tests/contest-repository.test.ts`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/contest/repository.ts packages/shared/src/domain/story.ts apps/api/tests/contest-repository.test.ts
git commit -m "feat(api): persist contest records and story progress"
```

---

### Task 7: Story Simulation, Rewards, and NG+ Rules (T2.5/T2.7/T2.8)

**Files:**
- Create: `apps/api/src/modules/story/service.ts`
- Create: `apps/api/src/modules/story/rewards.ts`
- Create: `apps/api/src/modules/story/router.ts`
- Create: `apps/api/tests/story.test.ts`
- Create: `apps/api/tests/story-rewards.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/errors.ts` only if a missing existing error code is required

**Interfaces:**
- Consumes: `CONFIG.stages`, `CONFIG.problems`, `simulateRanking`, NPC generator, repository methods, M1 settle/student/item services.
- Produces: `GET /api/story/overview?ngLevel=`, `POST /api/story/stages/:stageKey/enter`, `GET /api/story/progress`, `GET /api/records/:recordId`; `enterStoryStage(userId, stageKey, ngLevel, roster, idempotencyKey)`.

- [ ] **Step 1: Write failing API and reward tests**

Cover chapter/stage unlock chain, roster size one, active student ownership, stamina cost chapters 1–4 versus 5–8, snapshot freezing, failed retry behavior, first-clear reward amounts from stages/economy, milestone only at NG level 0, repeat rank bonuses, reward idempotence, record ownership, and full-clear reward `500000 + badge-legend + trophy-gold + NG+ unlock`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm test -- apps/api/tests/story.test.ts apps/api/tests/story-rewards.test.ts`.
Expected: FAIL because story routes/services and M2 persistence are absent.

- [ ] **Step 3: Implement stage overview and progress projection**

Load stage definitions from frozen CONFIG, merge progress rows for the requested NG layer, mark prior-stage and prior-chapter unlocks, and return only the authenticated user's data. Default `ngLevel=0`; reject negative or unavailable layers with the existing validation/state error semantics.

- [ ] **Step 4: Implement transactional stage entry**

Validate idempotency key, roster, ownership/status, unlocks, and settled stamina. In one transaction conditionally deduct chapter stamina, freeze student and question/NPC snapshots, derive the seed from stage/layer/idempotency inputs, run the pure ranking simulator, insert the contest record and progress row, then apply rewards. If the same idempotency key is replayed, return the original record without another deduction or reward.

- [ ] **Step 5: Implement reward and NG+ calculations**

Read money, item, milestone, full-clear and NG+ values from CONFIG; apply the documented layer multiplier to money and eligible rewards, exempt advance-stone/legend-box milestone items where specified, and use conditional updates/upserts. Detect all 33 first clears at `ngLevel=0`; award full-clear rewards exactly once and make NG+ level 1 available. Track each NG layer independently and require the previous layer full clear before opening the next.

- [ ] **Step 6: Add routes and record retrieval**

Mount the story router and authenticated record route in `createApp`. Return the common API envelope, map missing/non-owned records to the existing not-found behavior, and never rerun a persisted simulation during reads.

- [ ] **Step 7: Run focused integration tests**

Run: `pnpm test -- apps/api/tests/story.test.ts apps/api/tests/story-rewards.test.ts`.
Expected: PASS for first clear, retry, NG+, full clear and ownership cases.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/story apps/api/src/index.ts apps/api/tests/story*.test.ts apps/api/src/lib/errors.ts
git commit -m "feat(api): add story mode simulation and rewards"
```

---

### Task 8: Story and Report Web UI (T2.6)

**Files:**
- Create: `apps/web/src/features/story/StoryPage.tsx`
- Create: `apps/web/src/features/records/RecordReportPage.tsx`
- Modify: `apps/web/src/lib/hooks.ts`
- Modify: `apps/web/src/lib/api.ts` only where the existing client abstraction needs a typed method
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: Story overview/entry/progress and record DTOs from Task 7.
- Produces: `/story` chapter/stage tree with NG+ selector, stage entry flow, and `/records/:recordId` unified ranking/duel report renderer.

- [ ] **Step 1: Implement typed query/mutation hooks**

Add query keys and hooks for story overview, story progress, stage entry, and record retrieval. Invalidate overview/progress after a stage mutation and navigate to the returned record id.

- [ ] **Step 2: Build the story stage tree**

Render eight chapters and 33 configured stages with locked/unlocked/cleared states, roster selection using existing student data, stamina cost, and an entry action. Keep the NG+ layer selector disabled for unavailable layers and display server errors using existing UI conventions.

- [ ] **Step 3: Build the report renderer**

Render report metadata, ranking standings, duel score summaries, per-question timeline verdict colors, energy/focus/mindset changes, and reward summary. Use responsive horizontal scrolling only within long timelines/tables; do not introduce a page-wide horizontal overflow.

- [ ] **Step 4: Wire routes and empty/loading/error states**

Add `/story` and `/records/:recordId` to the existing authenticated route tree. Reuse the M1 layout, buttons, typography, and error conventions; do not add a separate design system.

- [ ] **Step 5: Run build and manual smoke**

Run: `pnpm build && pnpm typecheck && pnpm lint`.
Expected: PASS. Manually verify login → story overview → enter unlocked stage → report page at desktop and narrow mobile width.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/story apps/web/src/features/records apps/web/src/lib apps/web/src/app/App.tsx
git commit -m "feat(web): add story stages and contest reports"
```

---

### Task 9: M2 Quality Gate and Roadmap Closure

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `README.md` only if the final smoke command needs documenting
- Create: `apps/api/tests/m2-golden.test.ts` if a consolidated deterministic golden test is not already present

**Interfaces:**
- Consumes: All M2 modules and real YAML configuration.
- Produces: verified M2 milestone with recorded test/smoke evidence.

- [ ] **Step 1: Add consolidated golden and end-to-end assertions**

Assert same seed produces the same ranking and duel JSON, all 33 stages parse, a stage first clear stores one record and one progress row, repeated idempotent entry does not duplicate rewards, and full clear unlocks NG+.

- [ ] **Step 2: Run the complete quality gate**

Run: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
Expected: all commands exit 0; record the actual local MariaDB and non-Docker environment in the roadmap.

- [ ] **Step 3: Run HTTP smoke checks**

Using a seeded coach account, verify `GET /api/story/overview`, one valid stage entry, `GET /api/records/:recordId`, and a repeated idempotency request. Verify the response envelopes and that stamina/money/reward quantities change once.

- [ ] **Step 4: Update the roadmap with evidence**

Check T2.1–T2.8 only after their tests and smoke checks pass. Add a dated M2 measurement note with exact commands, test count, database environment, and any explicitly deferred Docker/browser checks.

- [ ] **Step 5: Commit the documentation and quality gate**

```bash
git add docs/ROADMAP.md README.md apps/api/tests/m2-golden.test.ts
git commit -m "docs: close M2 contest and story milestone"
```

---

## Self-Review Checklist

- [ ] Every ROADMAP item T2.1–T2.8 maps to at least one task: T2.1→2, T2.2→3, T2.3→4, T2.4→5, T2.5→6–7, T2.6→8, T2.7→7, T2.8→7.
- [ ] No task imports future PVP/adventure models; nullable future relationships remain outside M2.
- [ ] The existing M1 `/api/problems` user-library endpoint remains distinct from the M2 configuration bundle.
- [ ] All later interfaces match earlier names: `RankingInput`, `DuelInput`, `simulateRanking`, `simulateDuel`, `ContestReport`, `CONFIG.problems`, `CONFIG.stages`, repository methods, and story routes.
- [ ] No placeholder terms such as TBD, TODO, or “implement later” remain in the plan.
- [ ] Numerical rules point to `contest.md`, `progression.md`, or YAML rather than embedding new balance values.
- [ ] The plan leaves no requirement without a testable task, and each task ends with a focused test or quality-gate command.
