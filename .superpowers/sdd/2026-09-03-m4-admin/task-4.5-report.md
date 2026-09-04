# T4.5 PVP problem reputation

## TDD evidence

- RED: the new scheduler integration test observed no reputation after an opponent failed a carried Q100 problem.
- GREEN: focused scheduler and duel suites pass: 21 tests.
- Coverage verifies per-match idempotency across replay and the configured twelve-point per-problem tournament cap.

## Implementation

- `apps/api/src/modules/pvp/scheduler.ts`: read the PVP reputation constants from the frozen economy config; inspect only unsolved `PREMADE` rounds; credit the setter with a stable `PVP_PROBLEM` reason key; enforce per-match occurrence and per-tournament aggregate caps in the same transaction as the match result.
- `apps/api/tests/pvp-scheduler.test.ts`: add unsolved carried-problem credit/replay coverage and a twelve-point cap case.

## Quality gates

- Focused scheduler + duel suites: pass (21/21 tests).
- Full API suite: pass (35 files, 286 tests) with `--no-file-parallelism` for the shared test database.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm build`: pass.
- `prisma validate`: pass.
- `prisma migrate status`: database schema up to date.
- `git diff --check`: pass.

## Deferred

- Docker startup, browser flow, and visual acceptance remain deferred to the final M4/M5 deployment window as requested.
