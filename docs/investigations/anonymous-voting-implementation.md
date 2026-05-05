# Anonymous Voting Budget — Implementation Brief

**Branch:** `feat/anonymous-voting-budget` (off `main` at `0a5a4438`)
**Builds on:** Phase 3 (`feat/phase3-behavioural-blending`, merged as `1ded571`)
**Scope:** Vote-page anonymous allowance + Predict-page popup unification + post-signup return UX

## Locked decisions

| # | Decision |
|---|---|
| D1 | N = 8 cumulative anonymous votes per identity, no time window |
| D2 | Unit = (surface_type, target_id). Value-vote + approval-rating on same person = 1 unit. |
| D3 | Re-voting = 0 additional units (upsert) |
| D4 | IP-secondary cap = 40 votes/IP/24h |
| D5 | Allow N votes, gate on (N+1)th |
| D6 | Single primary "Create account", secondary "Sign in" link |
| D7 | No Vote-page toast — direct redirect to /login?reason=vote_limit_reached + popup |
| D8 | Discard anonymous votes at signup |
| D9 | Post-signup return: land on Vote page, auto-open the original action |
| D10 | Storage: new anon_vote_budget table for tracking units |
| D11 | Anonymous votes persist in their normal tables with userId = anon_<fdx_sid> |

## High-level architecture

The system tracks anonymous voting via three layered mechanisms:

**Layer 1 — Identity (fdx_sid cookie).** Every anonymous user gets a stable UUID cookie on their first visit to any /api/* endpoint. This replaces the brittle IP+UA hash for vote attribution.

**Layer 2 — Budget tracking (anon_vote_budget table).** Every successful anonymous vote inserts a row recording (fdx_sid, surface_type, target_id, created_at). The unique constraint on (fdx_sid, surface_type, target_id) makes re-votes free (zero additional units). The count of rows for a fdx_sid IS the budget consumed.

**Layer 3 — Vote persistence (existing tables).** Anonymous votes write to votes, userVotes, celebrityValueVotes exactly as authenticated votes do, but with userId = 'anon_' + fdx_sid. They contribute to community totals immediately. At signup, all rows where userId LIKE 'anon_<their-cookie>%' are deleted.

## Schema changes

### Migration: 0046_anon_vote_budget.sql

```sql
-- Phase 4 — Anonymous voting budget
-- Tracks budget units consumed by anonymous identities (fdx_sid cookie).
-- One row per (fdx_sid, surface_type, target_id). Re-votes are upserts → 0 additional units.
-- All rows for a given fdx_sid are deleted when the user signs up.

CREATE TABLE IF NOT EXISTS public.anon_vote_budget (
  fdx_sid       text NOT NULL,
  surface_type  text NOT NULL,
  target_id     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fdx_sid, surface_type, target_id),
  CONSTRAINT anon_vote_budget_surface_check CHECK (surface_type IN (
    'sentiment_poll',
    'matchup_poll',
    'opinion_poll',
    'induction',
    'trending_poll',
    'celebrity_person'
  ))
);

CREATE INDEX IF NOT EXISTS anon_vote_budget_sid_idx 
  ON public.anon_vote_budget (fdx_sid);

CREATE INDEX IF NOT EXISTS anon_vote_budget_created_idx 
  ON public.anon_vote_budget (created_at);
```

**Note:** D2 unifies value-vote and approval-rating under 'celebrity_person' (one unit per person). The other surfaces map 1:1.

### Drizzle schema (shared/schema.ts)

Add a corresponding pgTable definition matching the SQL above. Mirror the column types, primary key, and check constraint.

## Backend changes

### File: server/lib/anonIdentity.ts (new)

Single source of truth for the anonymous-identity cookie.

- Constants: FDX_SID_COOKIE = 'fdx_sid', FDX_SID_MAX_AGE = 365 * 24 * 60 * 60.
- Function ensureFdxSid(req, res): string — read from cookies, generate via randomUUID() if missing, set cookie with httpOnly, sameSite: 'lax', secure in production, path: '/', return UUID.

### File: server/middleware/anonIdentityMiddleware.ts (new)

Express middleware that runs ahead of optionalAuth on all /api/* routes. Calls ensureFdxSid() so every anonymous user has a cookie regardless of which endpoint they hit first. Mount in server/index.ts after cookie-parser middleware, before route mounts.

### File: server/auth-middleware.ts (modify)

Update optionalAuth to populate req.sessionId from the fdx_sid cookie (now guaranteed to exist due to the new middleware). The anon_<IP+UA hash> fallback stays as defence-in-depth but should never fire in practice.

### File: server/lib/anonBudget.ts (new)

Budget logic. Two functions:

- getBudgetStatus(fdxSid: string): Promise<{ used, limit, remaining, exhausted }> — limit comes from ANON_VOTE_BUDGET env (default 8).
- consumeBudgetUnit(fdxSid, surfaceType, targetId): Promise<{ consumed, newCount, exhausted }> — does INSERT ... ON CONFLICT DO NOTHING against anon_vote_budget. Returns whether a new row was inserted (i.e. whether it consumed a unit).

### File: server/lib/rankingConfig.ts (modify)

Add the new env-backed tunables:

```ts
export const ANON_VOTE_BUDGET = readNumberEnv('ANON_VOTE_BUDGET', 8);
export const ANON_VOTE_IP_DAILY_CAP = readNumberEnv('ANON_VOTE_IP_DAILY_CAP', 40);
```

### File: server/middleware/anonRateLimit.ts (new)

Per-IP secondary rate limit. In-memory map similar to existing voteRateLimit, with 24h sliding window. Keys off req.ip. Counts only requests where req.userId is undefined (anonymous). At 40 anonymous vote-write attempts in 24h from one IP, return 429 with a specific error code.

### File: server/routes.ts (modify — multiple sites)

For each of the 7 vote-style write endpoints currently using requireAuth:

1. Sentiment polls — POST /api/polls/:slug/vote
2. Opinion polls — POST /api/opinion-polls/:slug/vote
3. Induction — POST /api/vote/induction/:id/vote
4. Value-vote — POST /api/celebrity/:id/value-vote
5. Approval-rating — POST /api/celebrity/:id/approval-rating
6. Trending polls — POST /api/trending-polls/:id/vote
7. Matchups — POST /api/matchups/:id/vote (already optionalAuth, just gets budget logic added)

Change pattern for each:

- Replace requireAuth with optionalAuth.
- After auth resolution, branch on req.userId:
  - **Authenticated path:** existing behaviour, plus existing Phase 3 engagement-write hooks.
  - **Anonymous path:** read fdx_sid cookie, call consumeBudgetUnit(fdxSid, surfaceType, targetId). If result.exhausted, return 403 with { error: 'budget_exhausted', budgetLimit, budgetUsed }. Otherwise, write the vote with userId = 'anon_' + fdxSid to the existing vote tables.
- Return budget status in response so client can mirror.

**Special case for celebrity profiles (D2):** value-vote and approval-rating both consume the same (fdx_sid, 'celebrity_person', personId) unit. Handled cleanly by the unique constraint — the second one is a free upsert.

**Engagement-write hooks (Phase 3) must NOT fire for anonymous votes.** The existing if (req.userId) guard in engagementWriter already enforces this — leave it.

### Endpoint: GET /api/anon-budget (new)

Lightweight endpoint the client calls on Vote-page mount to read current budget state. Returns:

- authenticated: boolean
- used: number
- limit: number
- remaining: number
- exhausted: boolean

For authenticated users, returns { authenticated: true, ... } with no budget enforcement.

## Frontend changes

### File: client/src/hooks/useAnonBudget.ts (new)

Custom React hook that fetches /api/anon-budget on mount and exposes:

```ts
const { used, limit, remaining, exhausted, isAnonymous } = useAnonBudget();
```

Updates after every vote response (the server returns budget status in vote response bodies).

### File: client/src/lib/voteGate.ts (new)

Pre-submission gate. Called by every vote handler before the API call:

```ts
checkVoteGate(budget, surfaceType, targetId, isUpsert): { proceed, redirectToSignup }
```

Logic:
- Authenticated → always proceed.
- Anonymous + isUpsert (re-vote) → proceed (free).
- Anonymous + budget.used < N → proceed.
- Anonymous + budget.used === N (next vote would be N+1) → redirect.

isUpsert determined client-side from local "have I voted on this target" state.

### File: client/src/lib/authReturn.ts (modify)

Extend navigateToLogin() to accept richer context:

```ts
navigateToLogin(setLocation, {
  mode: 'signup',
  reason: 'vote_limit_reached' | 'predict_signup',
  resumeAction?: {
    surfaceType: string;
    targetId: string;
    cardRoute?: string;
    pendingVote?: any;
  }
})
```

Reason and resumeAction get serialised into sessionStorage and the URL query param.

### File: client/src/pages/LoginPage.tsx (modify)

On mount, read ?reason= from URL. If set, render the new popup overlay component.

### File: client/src/components/auth/SignupReasonModal.tsx (new)

Popup overlay. Centred, dismissible (X + click-outside), backdrop blur. Reads reason from URL query param and renders one of two variants:

**Variant A — reason=vote_limit_reached:**
- Heading: "You're getting into it."
- Body: "Create a free account to keep voting and start contributing to the rankings."
- Primary: "Create account"
- Secondary: "Already have an account? Sign in."

**Variant B — reason=predict_signup:**
- Heading: "Predicting needs an account."
- Body: "Create a free account to start predicting and build your track record."
- Primary: "Create account"
- Secondary: "Already have an account? Sign in."

Closing the popup leaves the user on LoginPage. The popup just adds context.

**Wording is placeholder — to finalise post-build via 2-3 variants tested with users.**

### File: client/src/pages/VotePage.tsx (modify)

Update each vote handler to call checkVoteGate() before the API call. On gate failure, fire navigateToLogin() with resumeAction payload. Extend redirectAfterLogin() to handle resumeAction — navigate to cardRoute and auto-open the action.

### File: client/src/pages/PredictPage.tsx (modify)

Replace the 5 duplicated toast("Sign in required", ...) calls with navigateToLogin(setLocation, { mode: 'signup', reason: 'predict_signup' }). Predict page itself stays publicly viewable.

### File: client/src/components/AnimatedSentimentVotingWidget.tsx (modify)

Same gate pattern. Pre-submission check on the "Submit Your Vote" button. Pass personId and surface type 'celebrity_person'.

### Files: client/src/pages/MatchupDetailPage.tsx and client/src/pages/PersonDetailPage.tsx (modify)

Apply the same gate pattern to their vote handlers. (These are what Composer 2 mistakenly tried to fix earlier — now done correctly under the budget model.)

## Signup flow integration

### File: server/routes.ts (modify — signup handler)

In the existing signup endpoint, after creating the user but before responding:

1. Read fdx_sid cookie from request.
2. Run cleanup transactionally:
   - DELETE FROM anon_vote_budget WHERE fdx_sid = $1
   - DELETE FROM votes WHERE userId = 'anon_' || $1
   - DELETE FROM userVotes WHERE userId = 'anon_' || $1
   - DELETE FROM celebrityValueVotes WHERE userId = 'anon_' || $1
3. The cookie itself stays — same identity, now linked to a real user via session.

This is the v1 "discard at signup" behaviour. If/when we revisit and decide to backfill (D8 reversal), this DELETE block becomes a migration block instead.

## Testing plan

**Unit tests** (tests/anon-budget.test.ts — new):

- consumeBudgetUnit returns consumed: true for new combos.
- consumeBudgetUnit returns consumed: false, newCount unchanged for re-votes.
- getBudgetStatus returns correct counts after N inserts.
- getBudgetStatus.exhausted becomes true at exactly N+1.
- Value-vote and approval-rating on same person = 1 unit.
- Different sids don't interfere.
- CHECK constraint rejects invalid surface_type values.

**Integration tests** (tests/anon-vote-flow.test.ts — new):

- Anonymous user can vote on each of the 7 surfaces.
- After 8 votes across distinct targets, the 9th returns 403 with budget_exhausted.
- Re-voting on the same target doesn't consume budget.
- The IP-secondary cap fires at 40 attempts.
- Authenticated users have no budget enforcement.

**Manual verification post-deploy:**

1. Open production VoxDex in incognito.
2. Verify fdx_sid cookie is set on first page load.
3. Cast 8 votes across different cards. Each succeeds.
4. Cast a 9th — verify redirect to /login?reason=vote_limit_reached.
5. Verify popup appears on LoginPage.
6. Close the popup — verify LoginPage stays accessible.
7. Sign up.
8. Verify redirect back to Vote page.
9. Verify anon_vote_budget rows for that fdx_sid are gone.
10. Verify the original anonymous votes in votes etc. are also gone.
11. Verify the now-authenticated user can vote again, no gate.
12. Re-vote on a target previously voted as anonymous — confirm fresh vote.
13. Test the same flow on Predict — verify popup variant B.
14. Test the IP cap by scripting 40 anonymous votes across browsers — verify 41st gets blocked.

## Out of scope (deliberate)

- Backfill of anonymous votes at signup (D8 — discard for v1).
- Anonymous personalisation / Phase 3 ramp pre-loading.
- CAPTCHA / anti-bot.
- Comment voting and curate-image voting in the budget.
- Predict page interaction model overhaul (only toast/popup wording changes).
- Anonymous market favouriting.
- Toast position globalisation.
- Analytics/telemetry for budget exhaustion → conversion (post-launch).

## Phase 4a follow-ups (separate PR)

- Toast wording experiments (A/B test variants).
- Anonymous engagement migration at signup (revisit D8).
- CAPTCHA on (N+1)th attempt.
- Budget reset / amnesty mechanic.
- Add automated test coverage for anon-budget (unit + integration). Deferred from Stage 8 — cost-benefit flips when public users land.

## Verification checklist (post-merge to main)

1. Migration 0046_anon_vote_budget row in schema_migrations.
2. anon_vote_budget table exists in production Supabase.
3. CHECK constraint rejects invalid surface_type values.
4. fdx_sid cookie set on first request to any /api/* endpoint.
5. Anonymous user can vote on all 7 surfaces.
6. After 8 distinct-target votes, 9th attempt redirects.
7. Popup appears on LoginPage with correct copy variant.
8. Re-voting on same target doesn't consume budget.
9. Value-vote + approval-rating on same person = 1 unit.
10. Predict page surfaces popup variant B.
11. Signup flow deletes anon_vote_budget rows + anonymous vote rows.
12. Post-signup return lands on the original card with action ready.
13. Per-IP cap fires correctly at 40 attempts.