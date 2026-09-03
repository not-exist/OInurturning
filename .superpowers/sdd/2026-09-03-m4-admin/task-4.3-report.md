# T4.3 PVP tournament scheduler

## TDD evidence

- RED: `pnpm -C apps/api test tests/pvp-scheduler.test.ts` failed because `scheduler.js` was not present.
- GREEN: focused scheduler and registration suites pass: scheduler 8 + registration 4 = 12 tests.
- Added coverage for deterministic odd-count byes, underfilled cancellation/refund idempotency, eight- and sixteen-player advancement to `FINISHED`, immutable live-row changes, and concurrent duplicate-safe match/record creation.

## Implementation

- `apps/api/src/modules/pvp/scheduler.ts`: transaction-locked lazy advancement, minimum-player cancellation/refunds, first/next round persistence, immutable registration snapshot duel inputs, deterministic seeds, `simulateDuel`, idempotent `ContestRecord`, match projections, detail/bracket services.
- `apps/api/src/modules/pvp/router.ts`: authenticated detail and bracket routes, canonical `/registration` POST alias, existing `/register` and registration detail retained.
- `apps/api/src/modules/admin/router.ts`: authenticated admin `POST /api/admin/pvp-tournaments/:id/actions/start`.
- `apps/api/tests/pvp-scheduler.test.ts`: focused scheduler tests.

## Quality gates

- `pnpm -C apps/api typecheck`: pass
- `pnpm -C apps/api lint`: pass
- `pnpm -C apps/api build`: pass
- `pnpm -C apps/api test tests/pvp-scheduler.test.ts tests/pvp-registration.test.ts`: pass (scheduler 8 + registration 4 = 12 tests)
- `pnpm -C apps/api test`: first run exposed the global admin-audit assertion; after `129c876` audit fix, pass (35 files, 283 tests)
- `git diff --check`: pass
- `prisma validate`: pass
- `prisma migrate status`: reports pending intentional `20260903000000_pvp_matches` migration

## Concerns / deferred

- Docker/browser/manual acceptance remains deferred as requested.
- Full repository quality gates should be run by the parent integration branch.
- The development database still needs the pending PVP migration applied during integration.

## Commits

- `4a72fdf feat(api): add pvp tournament scheduler`
- Follow-up commit adds the seeded PVP schema/migration/bracket files and expanded scheduler coverage.

## Review follow-up

- Added Web bracket/detail rendering and query hooks in `apps/web/src/features/pvp/PvpPage.tsx` and `apps/web/src/lib/hooks.ts`.
- Added HTTP coverage for canonical detail/bracket/registration, auth/admin scope, admin audit, and away-side report access.
- PVP record links now authorize both match participants; unrelated users remain denied.
- Lock acquisition now captures default request time after `FOR UPDATE`; explicit test times remain supported.
- Question instance IDs use tournament/round/slot plus immutable snapshot hash, independent of auto-increment match IDs.
- Admin start writes `PVP_TOURNAMENT_START` audit entries.
- `PvpMatch.contestRecordId` is unique in schema and migration for the intended 1:1 relation.
- Registration and underfilled-advance race test has a 5s timeout and confirms cancellation/no deadlock.
- Registration now follows the scheduler's Tournament -> User -> Student lock order; focused race coverage confirms both paths settle.
- HTTP result coverage confirms match participants can read a linked report while an unrelated outsider receives 403/404.
- Review follow-up tests: scheduler focused suite 8 tests and registration suite 4 tests passed; Web typecheck/build and API typecheck/lint/build passed.
- Final focused: scheduler 8 + registration 4 = 12 tests passed. Final full API: 35 files, 283 tests passed. The first full run exposed the global admin-audit assertion; after `129c876` fixed that audit path, the rerun passed.
