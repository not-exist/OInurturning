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

The CLI validates schema presence, profile/reference semantics, target configuration, and simulation errors before calculating. JSON uses `JSON.stringify(report, null, 2)`, preserving canonical profile and line-item order; zero expense is represented as `null` by the pure engine.

## Review Fix Round 1

Fixed all review findings in commit pending this report update:

- Added `reporter: silent` to `pnpm-workspace.yaml`, which suppresses pnpm lifecycle banners at the project boundary. The exact required invocation, `pnpm sim:economy -- --json`, now emits JSON-only stdout. A Vitest child-process regression executes that command and parses `stdout`.
- Corrected semantic issue path interpolation to select `economy.yaml`, `items.yaml`, or `stages.yaml` by `issue.file` rather than interpolating the path map object.
- Wrapped each shared-schema parse error with its source YAML path.
- Rejected `simulation.target_profile` values other than `mid` with `simulation.target_profile` in the error.
- Emitted `meta.calibration_profile.target_income_expense_ratio` when the calculated target gate fails, while retaining JSON report output and status 1.

Fresh verification:

```text
pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism -t "CLI"
Test Files  1 passed (1)
Tests  9 passed | 19 skipped (28)

pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism
Test Files  1 passed (1)
Tests  28 passed (28)

pnpm sim:economy -- --json | JSON.parse(...)
beginner,mid,late true

git diff --check
exit 0
```

## Review Fix Round 2: Blocked

The requested contracts are incompatible with pnpm 10.14.0 project configuration:

- Removing the project-wide `reporter: silent` restores `pnpm run this-script-does-not-exist` diagnostics: exit `1`, stdout `117` bytes, stderr `0` bytes.
- With that setting removed, the required `pnpm sim:economy -- --json` exits `0` but stdout begins with pnpm's lifecycle banner:

```text
> oinurturning@ sim:economy /home/qzez/OInurturning
> pnpm -C apps/api exec tsx ../../scripts/sim-economy.ts -- --json
```

Consequently `JSON.parse(stdout)` fails with `Unexpected token '>'` before it reaches the CLI JSON.

Experiments: `pnpm --loglevel error|warn|silent sim:economy -- --json` each still emitted `3776` stdout bytes including the lifecycle banner. `pnpm --silent` does suppress it, but requires changing the mandated caller command. Project `reporter: silent` is the only tested configuration that makes the exact command JSON-only, and it also suppresses unknown-script diagnostics entirely, so it was removed.

Added paired child-process coverage. The unknown-script diagnostic assertion passes; the exact-command JSON assertion fails solely on the pnpm banner. No fix-round-2 commit was made because committing this state would intentionally leave the required focused suite failing.

## Review Fix Round 2: Ruling Applied

The controller ruled that machine-readable root invocation is `pnpm --silent sim:economy -- --json`. This is the only scoped pnpm 10.14.0 interface that preserves JSON-only stdout without suppressing diagnostics for every workspace command. The project-wide `reporter: silent` setting was removed, the root command regression now supplies `--silent`, and a paired regression confirms an unknown pnpm script still emits diagnostics.

Verification:

```text
pnpm -C apps/api exec vitest run tests/economy-simulation.test.ts --no-file-parallelism -t "CLI"
Test Files  1 passed (1)
Tests  10 passed | 19 skipped (29)
```
