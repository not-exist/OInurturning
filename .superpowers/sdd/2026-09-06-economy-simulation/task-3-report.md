# Task 3 Report: Standalone Economy Simulation CLI

## RED evidence

Added four CLI tests to `apps/api/tests/economy-simulation.test.ts`, then ran:

```text
pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism -t "CLI"
Error: Cannot find module '../src/scripts/sim-economy.js'
```

The failure was caused by the intentionally missing CLI module.

## GREEN evidence

Focused CLI tests after implementation:

```text
Test Files  1 passed (1)
Tests  4 passed | 19 skipped (23)
```

Full economy simulation test file:

```text
Test Files  1 passed (1)
Tests  23 passed (23)
```

Real text command (`pnpm sim:economy`) exited 0 and printed all profiles, including:

```text
beginner ... ratio: 0.7624
mid ... ratio: 1.0489
late ... ratio: 7.3239
target: mid [0.9, 1.15] actual=1.0489 PASS
```

Real JSON command (`pnpm --silent sim:economy -- --json`) parsed successfully and reported:

```text
beginner,mid,late true 0.762423417290674,1.0488958990536277,7.323905796322185
```

## Implementation

- `apps/api/src/scripts/sim-economy.ts`: standalone YAML loader using `parseDocument`, shared schemas, semantic cross-file validation, pure simulation invocation, stable text/JSON rendering, injected `loadData` seam, and status return.
- `scripts/sim-economy.ts`: thin wrapper that sets `process.exitCode` from `run` (without server/database imports).
- Root `package.json`: adds `sim:economy` script.
- `apps/api/tests/economy-simulation.test.ts`: text, JSON, malformed-data path, and zero-expense `ratio: null` coverage.

## Quality checks

`pnpm -C apps/api typecheck` reports existing Prisma client failures in `src/modules/pvp/rewards.ts` and tests; it also caught and led to fixing one CLI path-map type error.

`pnpm -C apps/api lint` reports existing `no-explicit-any` violations in the simulation module and economy tests. `git diff --check` exits 0.

## Self-review and concerns

The CLI validates schema presence, profile/reference semantics, target configuration, and simulation errors before calculating. JSON uses `JSON.stringify(report, null, 2)`, preserving canonical profile and line-item order; zero expense is represented as `null` by the pure engine. The root pnpm command includes pnpm lifecycle logs unless invoked with `--silent`; the emitted CLI payload itself is valid stable JSON.
