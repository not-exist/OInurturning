# T4.6 PVP rewards and claiming

## TDD evidence

- RED: the new scheduler integration test received 404 because the public reward grant endpoint did not exist.
- GREEN: focused PVP scheduler, registration, and admin suites pass after adding grants, claiming, and prize configuration.
- Coverage verifies default reward buckets, mandatory single champion `tag-card`, idempotent claim replay, admin prize updates before cutoff, and freeze after start.

## Implementation

- `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20260904120000_pvp_reward_grants/migration.sql`: add one unique reward grant per tournament/user with rank, JSON reward lines, and `claimedAt`.
- `apps/api/src/modules/pvp/rewards.ts`: derive standings from the persisted bracket, normalize/validate admin prize buckets, force the champion tag-card, create grants idempotently, list public grants, and atomically claim money/items/reputation.
- `apps/api/src/modules/pvp/scheduler.ts`: create reward grants when a tournament reaches `FINISHED`, including recovery for already-finished tournaments.
- `apps/api/src/modules/pvp/router.ts`: add public reward listing and authenticated claim routes.
- `apps/api/src/modules/admin/service.ts` and `apps/api/src/modules/admin/router.ts`: validate creation prizes and add cutoff-bound PATCH prize updates with audit logging.
- `apps/web/src/lib/hooks.ts`, `apps/web/src/features/pvp/PvpPage.tsx`, `apps/web/src/features/admin/AdminPage.tsx`: expose reward status/claim controls and JSON prize entry.
- `apps/api/tests/pvp-scheduler.test.ts` and `apps/api/tests/admin.test.ts`: integration coverage for rewards and admin boundaries.

## Quality gates

- Focused PVP scheduler + registration + admin suites: pass (21 tests).
- Full API suite: pass (35 files, 289 tests) with `--no-file-parallelism` for the shared test database.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm build`: pass.
- `prisma validate`: pass.
- `prisma migrate status`: database schema up to date after `20260904120000_pvp_reward_grants`.
- `git diff --check`: pass.

## Deferred

- Docker startup, browser flow, and visual acceptance remain deferred to the final M4/M5 deployment window as requested.
