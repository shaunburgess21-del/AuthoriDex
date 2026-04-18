# Follow-up tickets

Deferred work surfaced during other tasks. Add to this list; clear as items ship.

## Rank-system drift (from Task 2, 2026-04-18)

- **Hardcoded rank colours/icons on client.** `RankBadgeDisplay` in `client/src/components/UserMenu.tsx` and `RankBadge` in `client/src/pages/MePage.tsx` / `client/src/pages/PublicProfilePage.tsx` hardcode per-rank colour + icon in TypeScript. The `ranks` table now carries `color` and `icon` columns (and `description`). Wire these components to `useRanks()` so rank presentation stops drifting when a new tier ships. Pattern to follow: what `XPProgressBar` in `UserMenu.tsx` already does after Task 2.

- **Drizzle index declaration missing `DESC`.** `shared/schema.ts` declares `userActionDateIdx` on `xp_ledger` without explicit `DESC` on `created_at`, but the SQL migration `migrations/0011_xp_ledger_user_action_date_idx.sql` creates it with `DESC`. Postgres can use an ASC index with a reverse-scan for DESC queries, so runtime is fine, but `drizzle-kit generate` could later drop-and-recreate the index without `DESC`, causing silent drift from the migration. Investigate whether drizzle-orm's `.on()` supports asc/desc modifiers (`table.createdAt.desc()` or similar) and align the schema with the migration.

## Migration workflow reality (from Task 2 execution, 2026-04-18)

This project has `migrations/` SQL files AND `migrations/meta/_journal.json`,
but the journal only registers migrations 0000–0009. Files 0010 and 0011
(from Task 2) are in the folder but NOT journaled — `drizzle-kit migrate`
would not have run them.

In practice this project's schema workflow appears to be:
- `shared/schema.ts` is the source of truth
- `drizzle-kit push` (or `npm run db:push`) syncs schema.ts → DB
- `server/scripts/seed-gamification.ts` handles data (ranks, xp_actions, etc.)

Task 2's DDL files (`0010_*.sql` and `0011_*.sql`) were applied via a
targeted one-off script `scripts/apply-task-2.ts` which reads the SQL files
directly and executes their statements. This bypassed drizzle-kit entirely
because a `db:push` at that moment would have also tried to reconcile
pre-existing opinion-poll constraint drift (the `opinion_poll_votes_user_poll_unique`
constraint — in DB and schema.ts but considered different by drizzle-kit's diff).

Follow-up work for another session:
1. Investigate opinion-poll drift — why does drizzle-kit think schema.ts and
   DB don't match when they both appear to have the constraint? Likely a
   column-ordering or index-declaration mismatch. Fix so `db:push` runs clean.
2. Decide on a long-term migration strategy — either formalise journal-tracked
   migrations (populate the journal for 0005–0011) or commit to db:push + seed
   exclusively and retire the unregistered .sql files.

The helper scripts `scripts/check-db-state.ts` and `scripts/apply-task-2.ts`
remain in the repo as reference for future similar one-offs.

## Credits pill tappability (deferred from Task 3.6, 2026-04-18)

The mobile Credits pill (`PredictPage.tsx:~2598`) and the new desktop
Credits pill (`PredictPage.tsx:~<new line>`) are currently display-only
`<div>` elements. Plan: convert to `<Link>` or `<button>` routing to
a Credits management page where users can:
- View credit transaction history
- Purchase more credits via Paystack integration (phase 1 revenue)
- See XP → Credits conversion options (gated by tier per gamification plan)

Scope is its own task — Paystack integration, credits management page,
auth + rate limiting on purchase endpoints. Do not conflate with pill
visual work.
