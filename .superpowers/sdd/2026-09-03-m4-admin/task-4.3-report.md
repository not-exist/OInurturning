# T4.3 PVP tournament scheduler

## TDD evidence

- RED: `pnpm -C apps/api test tests/pvp-scheduler.test.ts` failed because `scheduler.js` was not present.
- GREEN: focused scheduler and registration suites pass: 8 tests passed.
- Added coverage for deterministic odd-count byes, underfilled cancellation/refund idempotency, eight-player advancement to `FINISHED`, and duplicate-safe match/record creation.

## Implementation

- `apps/api/src/modules/pvp/scheduler.ts`: transaction-locked lazy advancement, minimum-player cancellation/refunds, first/next round persistence, immutable registration snapshot duel inputs, deterministic seeds, `simulateDuel`, idempotent `ContestRecord`, match projections, detail/bracket services.
- `apps/api/src/modules/pvp/router.ts`: authenticated detail and bracket routes, canonical `/registration` POST alias, existing `/register` and registration detail retained.
- `apps/api/src/modules/admin/router.ts`: authenticated admin `POST /api/admin/pvp-tournaments/:id/actions/start`.
- `apps/api/tests/pvp-scheduler.test.ts`: focused scheduler tests.

## Quality gates

- `pnpm -C apps/api typecheck`: pass
- `pnpm -C apps/api lint`: pass
- `pnpm -C apps/api build`: pass
- `pnpm -C apps/api test tests/pvp-scheduler.test.ts tests/pvp-registration.test.ts`: pass (8 tests)
- `git diff --check`: pass
- `prisma validate`: pass
- `prisma migrate status`: reports pending intentional `20260903000000_pvp_matches` migration

## Concerns / deferred

- Docker/browser/manual acceptance remains deferred as requested.
- Full repository quality gates should be run by the parent integration branch.
- The development database still needs the pending PVP migration applied during integration.
