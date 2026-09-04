# T4.4 PVP tiebreak and quality scoring

## TDD evidence

- RED: the new scheduler integration test failed because PVP inputs hardcoded `qualityRuleOn: false`.
- GREEN: the focused scheduler and duel suites pass: 20 tests.
- Coverage verifies a tournament-level `rules.qualityScoring` setting reaches every generated PVP report while the tiebreak remains `SUDDEN_DEATH`.

## Implementation

- `apps/api/src/modules/pvp/scheduler.ts`: parse the tournament quality-scoring setting from nested rules, with top-level camelCase and snake_case compatibility; pass the resolved boolean to every duel input; retain the fixed PVP sudden-death tiebreak.
- `apps/api/tests/pvp-scheduler.test.ts`: add an end-to-end assertion over all three records in a four-player quality-scoring tournament.

## Quality gates

- Focused scheduler + duel suites: pass (20/20 tests).
- Full API suite: pass (35 files, 284 tests) with `--no-file-parallelism` for the shared test database.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm build`: pass.
- `git diff --check`: pass.

## Deferred

- Docker startup, browser flow, and visual acceptance remain deferred to the final M4/M5 deployment window as requested.
