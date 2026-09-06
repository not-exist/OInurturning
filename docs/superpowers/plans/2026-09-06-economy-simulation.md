# T5.1 Economy Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, YAML-driven weekly economy simulator for beginner, mid, and late player profiles, with a CI-checkable mid-profile ratio gate.

**Architecture:** Add a strictly shaped `simulation` section to the economy data while keeping legacy fixture imports compatible. Keep all calculations in a pure API module that consumes parsed economy, item, and stage data; keep YAML loading and text/JSON rendering in a standalone CLI with no database dependency.

**Tech Stack:** TypeScript, Zod, YAML `parseDocument`, pnpm workspace scripts, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-economy-simulation-design.md`

## Global Constraints

- Read all money and behavior parameters from `docs/data/*.yaml`; the calculation module contains no balance constants.
- Keep `economyConfigSchema.simulation` optional for existing minimal test fixtures; the CLI rejects a missing simulation section.
- Use fixed profile order `beginner, mid, late` and stable income/expense key order in text and JSON output.
- Use deterministic expectation values and never use `Math.random()`, a database, or player history.
- The mid-profile ratio must be checked against `economy.meta.calibration_profile.target_income_expense_ratio` (`[0.90, 1.15]` in the current data).
- Configuration/reference failures and a failed target gate exit with status 1 and identify the YAML path.
- Preserve unrelated user files, including `session-ses_fa34.md` and `session-ses_fafa.md`.
- Finish with API tests using `--no-file-parallelism`, workspace `typecheck`, `lint`, `build`, and `git diff --check`.

---

### Task 1: Add Simulation Configuration Contract

**Files:**
- Modify: `packages/shared/src/config/economy.ts`
- Modify: `docs/data/economy.yaml`
- Modify: `apps/api/src/config/semantic.ts`
- Test: `apps/api/tests/economy-simulation.test.ts`

**Interfaces:**
- Produces `simulationConfigSchema`, `simulationProfileSchema`, and their inferred types from the shared package.
- `EconomyConfig.simulation` is optional at schema level so existing minimal fixtures remain valid.
- The runtime simulation config has exactly three IDs: `beginner`, `mid`, and `late`.

- [ ] **Step 1: Write failing schema and reference tests**

Add tests that parse the real `docs/data/economy.yaml` and assert:

```ts
const parsed = economyConfigSchema.parse(realEconomy);
expect(parsed.simulation?.target_profile).toBe('mid');
expect(parsed.simulation?.profiles.map((profile) => profile.id)).toEqual(['beginner', 'mid', 'late']);
```

Add a malformed-config case with a duplicate profile ID or a negative session count and expect the parser to reject it. Add semantic cases for an unknown lecture tier, unknown priced book, unknown stage key, and a zero-total `rarity_mix`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts tests/config-m2-schema.test.ts --no-file-parallelism`

Expected: FAIL because `economy.yaml` has no `simulation` contract and the shared schema exposes no profile fields.

- [ ] **Step 3: Implement the schema, YAML profiles, and semantic checks**

In `packages/shared/src/config/economy.ts`, add strict shapes equivalent to:

```ts
const simulationProfileSchema = z.object({
  id: z.enum(['beginner', 'mid', 'late']),
  label: z.string().min(1),
  owned_students: z.number().int().nonnegative(),
  ability: z.number().finite().nonnegative(),
  reputation: z.number().int().nonnegative(),
  training: z.object({
    basic_sessions: z.number().nonnegative(),
    directed_sessions: z.number().nonnegative(),
    specialized_sessions: z.number().nonnegative(),
    directed_book_item_id: z.string().min(1),
  }).strict(),
  recruitment: z.object({
    recruits_per_week: z.number().nonnegative(),
    quality: z.enum(ECONOMY_QUALITY_TIERS),
    manual_refreshes_per_week: z.number().nonnegative(),
  }).strict(),
  lectures: z.object({ sessions: z.number().nonnegative(), tier: z.string().min(1) }).strict(),
  adventures: z.object({ sessions: z.number().nonnegative(), rarity_mix: z.record(z.number().nonnegative()).refine((mix) => Object.values(mix).some((weight) => weight > 0)) }).strict(),
  story: z.object({ sessions: z.number().nonnegative(), stage_key: z.string().min(1), rank_tier: z.enum(['champion', 'runner_up', 'third_to_eighth']), ng_level: z.number().int().nonnegative() }).strict(),
  passive: z.object({ sponsor_contracts: z.number().nonnegative(), substitute_coaches: z.number().nonnegative() }).strict(),
  fixed_weekly_expense: z.number().nonnegative(),
}).strict();
```

Add a `simulationConfigSchema` with `target_profile: z.enum(['beginner', 'mid', 'late'])` and exactly three profiles, then add `simulation: simulationConfigSchema.optional()` to `economyConfigSchema`.

Put the approved profile inputs from the spec into `docs/data/economy.yaml`. Extend `runSemanticChecks` with a `checkSimulation` function that verifies profile IDs are unique, lecture tiers exist, directed book IDs exist and have a non-null price, stage keys exist, and all rarity weights are finite with a positive total. Emit paths such as `simulation.profiles.mid.story.stage_key` for failures.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts tests/config-m2-schema.test.ts --no-file-parallelism`

Expected: PASS, including all malformed schema and cross-file reference cases.

- [ ] **Step 5: Commit the configuration contract**

```bash
git add packages/shared/src/config/economy.ts docs/data/economy.yaml apps/api/src/config/semantic.ts apps/api/tests/economy-simulation.test.ts apps/api/tests/config-m2-schema.test.ts
git commit -m "feat(m5): add economy simulation profiles"
```

### Task 2: Implement the Pure Simulation Engine

**Files:**
- Create: `apps/api/src/modules/economy/simulation.ts`
- Test: `apps/api/tests/economy-simulation.test.ts`

**Interfaces:**
- Consumes parsed `EconomyConfig`, `ItemDef` records, and `StageConfig` records from Task 1.
- Produces:

```ts
export interface SimulationInput { economy: EconomyConfig; items: Record<string, ItemDef>; stages: Record<string, StageConfig> }
export interface SimulationLine { key: string; amount: number }
export interface ProfileSimulation { id: 'beginner' | 'mid' | 'late'; label: string; income: SimulationLine[]; expenses: SimulationLine[]; incomeTotal: number; expenseTotal: number; net: number; ratio: number | null }
export interface EconomySimulationReport { profiles: ProfileSimulation[]; target: { profileId: string; min: number; max: number; actual: number | null; pass: boolean } }
export function simulateEconomy(input: SimulationInput): EconomySimulationReport
```

- [ ] **Step 1: Write failing pure-function tests**

Cover one formula per test: training session scaling, priced directed books, recruitment quality multiplier and fractional weekly recruitment, lecture reputation/overflow multipliers, rarity-weighted adventure midpoint, stage chapter money plus rank/NG+ multiplier, passive sponsor/coach income, line-item summation, and `ratio: null` when expenses are zero. Add a real-data test asserting profile order and finite totals.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism`

Expected: FAIL because `simulateEconomy` does not exist.

- [ ] **Step 3: Implement the minimum deterministic calculation engine**

Implement helpers with no literals for balance values:

```ts
function moneyLine(key: string, amount: number): SimulationLine { return { key, amount: Math.round(amount) }; }
function midpoint(range: { min: number; max: number }): number { return (range.min + range.max) / 2; }
function weightedAverage(weights: Record<string, number>, values: Record<string, number>): number {
  const entries = Object.entries(weights).filter(([key, weight]) => weight > 0 && Number.isFinite(weight) && Number.isFinite(values[key]));
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight === 0 ? 0 : entries.reduce((sum, [key, weight]) => sum + (weight / totalWeight) * values[key]!, 0);
}
```

Read training/recruitment/lecture/contest/adventure/passive values from the supplied economy object, read the selected book price from `items`, and resolve `stage_key` against `stages`. Use `ability` and `reputation` only as profile inputs to the lecture overflow and reputation curves. Generate fixed line keys (`lectures`, `adventures`, `story`, `passive.*`, `training.*`, `recruitment.*`, `books.*`, `fixed`) in profile order. Throw an error containing the profile/path when a referenced item or stage is absent.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism`

Expected: PASS with exact arithmetic assertions and no random or database access.

- [ ] **Step 5: Commit the pure engine**

```bash
git add apps/api/src/modules/economy/simulation.ts apps/api/tests/economy-simulation.test.ts
git commit -m "feat(m5): add deterministic economy simulation engine"
```

### Task 3: Add the Standalone CLI and Output Contract

**Files:**
- Create: `apps/api/src/scripts/sim-economy.ts`
- Create: `scripts/sim-economy.ts`
- Modify: `package.json`
- Test: `apps/api/tests/economy-simulation.test.ts`

**Interfaces:**
- `apps/api/src/scripts/sim-economy.ts` loads `docs/data/economy.yaml`, `items.yaml`, and `stages.yaml`, invokes `simulateEconomy`, and exports `run(argv?: readonly string[]): Promise<number>` for testability.
- `scripts/sim-economy.ts` is a thin `tsx` entrypoint that imports the API script and exits with its returned status.
- `pnpm sim:economy` runs the root entrypoint; `pnpm sim:economy -- --json` emits stable JSON.

- [ ] **Step 1: Write failing CLI tests**

Add tests that invoke `run([])` and `run(['--json'])` against the repository data, capture output, and assert:

```ts
expect(exitCode).toBe(0);
expect(json.profiles.map((profile) => profile.id)).toEqual(['beginner', 'mid', 'late']);
expect(json.target.pass).toBe(true);
```

Add a test-only loader seam to `run` (an optional second argument such as `{ loadData?: (path: string) => unknown }`) and inject malformed economy data through that seam; assert exit code 1 and that the reported error includes the failing data path. Add a zero-expense fixture assertion that JSON contains `ratio: null`, never `Infinity`.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism -t "CLI"`

Expected: FAIL because neither CLI entrypoint nor `run` exists.

- [ ] **Step 3: Implement YAML loading and rendering**

Use `parseDocument` and the existing shared schemas. Resolve data paths relative to the repository root exactly as `apps/api/src/scripts/recruit-stats.ts` does, without importing `apps/api/src/index.ts` or requiring `DATABASE_URL`. Validate `simulation` presence, profile IDs, cross-file references, and target ratio before calculating.

Render text with fixed sections and keys, then render `JSON.stringify(report, null, 2)` for `--json`. Return 1 for parse/reference errors or a failed target gate; return 0 otherwise. Keep the process wrapper responsible only for `process.exitCode`.

- [ ] **Step 4: Run CLI tests and the real command**

Run: `pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism -t "CLI"`

Then run: `pnpm sim:economy` and `pnpm sim:economy -- --json`

Expected: focused tests pass, text output contains all three profiles and `PASS`, JSON parses successfully, and both commands exit 0.

- [ ] **Step 5: Commit the CLI**

```bash
git add apps/api/src/scripts/sim-economy.ts scripts/sim-economy.ts package.json apps/api/tests/economy-simulation.test.ts
git commit -m "feat(m5): add economy simulation cli"
```

### Task 4: Integrate Regression Gates and Documentation

**Files:**
- Modify: `apps/api/tests/economy-simulation.test.ts`
- Modify: `docs/data/economy.yaml` (`sinks_summary` notes only if the generated result differs)
- Modify: `docs/ROADMAP.md`
- Modify: `now.tmp.md`
- Modify: `docs/TECH-DESIGN.md` if CLI path or output contract changes
- Create: `.superpowers/sdd/2026-09-06-m5/task-5.1-report.md`

**Interfaces:**
- The regression test owns the current real-data target assertion; it must fail if future YAML changes move the mid ratio outside the configured interval.
- The report records exact command results and whether the Docker/browser checks remain deferred.

- [ ] **Step 1: Add the real-data acceptance assertion**

Assert that `simulateEconomy` returns three finite profiles, each line-item sum equals its total, profile order is stable, and:

```ts
expect(report.target.profileId).toBe('mid');
expect(report.target.pass).toBe(true);
expect(report.target.actual).toBeGreaterThanOrEqual(report.target.min);
expect(report.target.actual).toBeLessThanOrEqual(report.target.max);
```

- [ ] **Step 2: Run the complete verification set**

Run in this order:

```bash
pnpm sim:economy -- --json
pnpm -C apps/api exec vitest run --no-file-parallelism
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: CLI exits 0; all API tests pass; workspace checks pass; no diff whitespace errors.

- [ ] **Step 3: Record the measured report**

Copy the actual three-profile totals and mid ratio into the T5.1 entry in `docs/ROADMAP.md`. Keep numeric source values in `economy.yaml`; do not hand-edit the report to hide a failed gate. Update `now.tmp.md` with the current branch/HEAD and the next task T5.2.

- [ ] **Step 4: Add the TDD handoff report**

Write `.superpowers/sdd/2026-09-06-m5/task-5.1-report.md` with RED/GREEN evidence, implementation files, exact quality-gate outputs, and the deferred Docker/browser acceptance note.

- [ ] **Step 5: Commit documentation and final integration**

```bash
git add apps/api/tests/economy-simulation.test.ts docs/data/economy.yaml docs/ROADMAP.md now.tmp.md docs/TECH-DESIGN.md .superpowers/sdd/2026-09-06-m5/task-5.1-report.md
git commit -m "docs(m5): record economy simulation results"
```

If implementation was done in a feature worktree, fast-forward merge its commits into `m2-contest-story` and verify that only the two user-provided session files remain untracked.

## Final Review Checklist

- [ ] `simulation` schema, profile IDs, and semantic cross-file references are validated.
- [ ] Pure engine has no database, random source, or hard-coded balance values.
- [ ] Text and JSON CLI output use stable ordering and finite numeric values.
- [ ] Mid-profile target uses the YAML-declared ratio interval and passes with the measured report.
- [ ] API/full workspace quality gates pass after the final documentation change.
- [ ] Docker/browser manual acceptance is explicitly recorded as deferred or completed at the final deployment window.
