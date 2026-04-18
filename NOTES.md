# Follow-up tickets

Deferred work surfaced during other tasks. Add to this list; clear as items ship.

## Rank-system drift (from Task 2, 2026-04-18)

- **Hardcoded rank colours/icons on client.** `RankBadgeDisplay` in `client/src/components/UserMenu.tsx` and `RankBadge` in `client/src/pages/MePage.tsx` / `client/src/pages/PublicProfilePage.tsx` hardcode per-rank colour + icon in TypeScript. The `ranks` table now carries `color` and `icon` columns (and `description`). Wire these components to `useRanks()` so rank presentation stops drifting when a new tier ships. Pattern to follow: what `XPProgressBar` in `UserMenu.tsx` already does after Task 2.

- **Drizzle index declaration missing `DESC`.** `shared/schema.ts` declares `userActionDateIdx` on `xp_ledger` without explicit `DESC` on `created_at`, but the SQL migration `migrations/0011_xp_ledger_user_action_date_idx.sql` creates it with `DESC`. Postgres can use an ASC index with a reverse-scan for DESC queries, so runtime is fine, but `drizzle-kit generate` could later drop-and-recreate the index without `DESC`, causing silent drift from the migration. Investigate whether drizzle-orm's `.on()` supports asc/desc modifiers (`table.createdAt.desc()` or similar) and align the schema with the migration.
