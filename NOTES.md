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

## XP awards on vote removal — design decision (2026-04-19)

Finding from Task 5.4 Phase 1 audit: Users who remove a vote (on matchups,
opinion polls, etc.) keep the XP they earned when they first voted. There is
no negative ledger entry or "refund" on vote removal.

This is working as intended, not a bug.

Rationale: XP rewards the *engagement* (participating in the vote), not the
final state of the vote. Penalising users for changing their mind with
retroactive XP loss creates bad incentives:
- Users become reluctant to vote when uncertain (voting feels "locked in")
- Users who realise they were wrong feel worse about self-correcting
- Encourages excessive deliberation before any vote

The current asymmetric design (earn on first vote, keep on removal) is
psychologically correct. Do not "fix" this as a bug in future refactors.

If a user could exploit this by repeated vote-remove-revote cycles, that
WOULD be a bug — but the Phase 1 audit confirmed it's not exploitable:
every vote action's idempotency key is keyed by (target, userId) only,
and ledger rows persist when vote rows are deleted. Re-voting after
removal hits the same idempotency key and is blocked at the DB constraint
level. Users can earn XP once per target, period.

## Daily-cap race condition — deferred hardening (2026-04-19)

Phase 1 audit flagged a theoretical race in GamificationService.awardXp:
two concurrent requests with distinct idempotency keys can both pass the
dailyCount check before either inserts, briefly exceeding the cap by 1.

Real-world impact: near zero. Would require sub-50ms concurrent requests
from the same user, which legitimate browser usage can't generate.

If evidence of abuse appears (ledger rows showing cap+1 entries within
<100ms for a user), the fix is a SELECT ... FOR UPDATE on a user lock row,
OR a DB-level check constraint counting same-action rows in the UTC day.

Until then, not worth the complexity.

## Signup return-to-prior-page — deferred (2026-04-19)

The auth-return flow handles sign-IN correctly but does NOT restore the prior page after sign-UP + email verification.

Why it's hard: Supabase email verification sends a link that, when clicked, often opens in a new browser tab or a different context than the one where the user submitted the signup form. The return-path snapshot lives in `sessionStorage`, which is scoped per tab+origin, so the newly opened verification tab cannot see the snapshot written by the original signup tab.

Options considered (all rejected for this PR):

1. **Move snapshot to `localStorage`.** Would survive the tab boundary, but introduces cross-tab leakage: a snapshot written on tab A could hijack the post-login redirect on tab B, even when B's user never went through `navigateToLogin`. Also survives browser restart, which is wrong UX.
2. **Embed the return path in the verification link's `redirectTo` / `next` param.** Requires server-side awareness of the return path at the time the verification email is sent (signup submission time) and a Supabase redirect allowlist that tolerates arbitrary subpaths. Doable, but expands the allowlist surface area and needs a `sanitizeReturnPath` equivalent on both ends.
3. **Post-verification handshake.** After verification, land the user on a neutral page that polls a short-lived server record keyed by user-id for the prior path. More moving parts; no compelling UX win over option 2.

Current behaviour: signup → email verification → user lands on `/` (or wherever Supabase's default post-verify redirect points). Not broken, just not contextual. Acceptable for now because signup is a one-time event per user and the post-signup "welcome to the app" destination is fine as a first impression.

Revisit if: analytics show meaningful drop-off between signup-started and signup-completed that correlates with losing context, or if a product requirement explicitly demands signup-context preservation.
