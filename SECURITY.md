# Security Notes

This document captures the project's data-access pattern so that future
contributors (human or AI) make safe choices by default.

## Data access pattern

**The browser never queries Supabase Postgres directly.** All data
reads and writes flow through our Express API:

```
Browser ──HTTPS──▶ Express (Railway) ──supabaseServer (service role)──▶ Postgres
```

- The client uses `@supabase/supabase-js` for **auth flows only**
  (sign-in, sign-up, password reset, OAuth callbacks). It uses the
  **anon key** for that, scoped to `auth.*`.
- Data tables in the `public` schema are read/written **only** from the
  Express server, via `server/supabase.ts → supabaseServer`, which holds
  the **service role key**. The service role bypasses RLS by design.
- Storage uploads (avatars, admin images) go through the Express API,
  which uses the service role to write to Supabase Storage.

There are intentionally **zero `supabase.from('…')` calls in `client/`**.
A grep for that pattern should always return empty. If you need new
data on the client, add an Express endpoint, not a direct Supabase query.

## Why RLS looks the way it does

Migration `0029_enable_rls_on_public_tables.sql` enabled Row Level
Security on every table in `public`. Two postures coexist:

1. **Backend-only tables** (logs, caches, agent state, raw metric
   snapshots, ingestion bookkeeping, schema versioning): RLS is
   **disabled** as of `0040_disable_rls_on_server_only_tables.sql`.
   The service role accesses these directly; no client should ever see
   them. Disabling RLS removes Supabase advisor noise without changing
   behaviour. The complete list lives in the body of that migration.

2. **User-data and user-facing tables** (profiles, comments, votes,
   polls, insights, market entries, jackpot entries, etc.): RLS is
   **enabled with no policies**. That means: anon and authenticated
   roles can read/write **nothing** via the Data API; only the service
   role (server) can touch them. Today the client never queries these
   directly so this is a no-op. But if a future change wires up a
   `supabase.from('profiles')…` call on the client, it will return an
   empty result instead of leaking data — that's the defense-in-depth
   we want to keep.

3. **Notifications and per-user preference tables** (`notifications`,
   `notification_preferences`, `notification_market_mutes`,
   `user_votes`, `user_favourites`): RLS is enabled **with owner-only
   policies** because these are also exposed to clients via Realtime
   subscriptions and direct Supabase reads in some hot paths. Each
   policy uses the `(select auth.uid())` form so it's evaluated once
   per query, not once per row (see `0038_rls_initplan_fix.sql`).

## Adding a new table

When adding a table in `shared/schema.ts` and a migration in
`migrations/`:

- If the table is **server-only** → add `ALTER TABLE … DISABLE ROW
  LEVEL SECURITY` (or simply leave RLS off; it's off by default for
  new tables).
- If the table is **user-facing but server-mediated only** → add
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and **no policies**.
- If the table will be **read directly by the client** (rare) → enable
  RLS and add owner-scoped policies, always using the
  `(select auth.uid())` form.

## Auth hardening

- **Leaked-password protection**: enable HaveIBeenPwned check in
  Supabase dashboard → Authentication → Policies → Password Strength.
  This is a dashboard-only toggle, not a migration.
- **Banned roles**: see `server/auth-middleware.ts`. The
  `requireAuth`/`optionalAuth` middleware loads `profiles.role`; a
  central check that rejects `role === 'banned'` lives at the
  middleware boundary, not on individual routes.

## Performance

- All foreign-key columns referenced by Supabase advisor in 2026-04
  now have covering indexes (`0039_fk_covering_indexes.sql`).
- RLS policies on user-owned tables use `(select auth.uid())` to avoid
  per-row re-evaluation (`0038_rls_initplan_fix.sql`).

## Things explicitly *not* fixed (with rationale)

- `extension_in_public` (`pg_trgm`): moving the extension to a
  dedicated schema requires updating every index and operator that
  references it. Low value, real risk. Defer.
- `unused_index` warnings (8 of them): Supabase flags these by
  scan-count. Several (e.g. `notifications_user_unread_idx`) will be
  used the moment the relevant feature is exercised at scale. Don't
  drop until we've confirmed they remain unused under real traffic.
- `auth_db_connections_absolute`: only matters when we upgrade Supabase
  plan size. Re-evaluate then.
