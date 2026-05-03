# Anonymous-Voting Model — Investigation

**Status:** read-only investigation. No code changes proposed; no working-tree edits made other than this document.
**Branch observed:** `feat/phase3-behavioural-blending`
**Date:** 2026-05-03
**Deliverable owner:** the user will review this document section by section and make product decisions before any implementation brief is written.

Tag conventions used throughout:

- `[CURRENT]` — what exists in the codebase now
- `[GAP]` — what is missing or inconsistent relative to the proposed unified model
- `[PROPOSAL]` — recommendation with reasoning
- `[OPEN_QUESTION]` — needs user decision before implementation

A note on the brief's "9 engagement surfaces" framing: the user's proposal enumerates six surfaces (sentiment polls, matchup polls, opinion polls, induction, value-vote, approval-rating). The Phase 3 commit (`1e2782bb`) describes "7 hooks at real write sites" plus 2 prediction-bet endpoints, totalling 9 engagement *paths* — but the 2 bet paths are real-economic-activity (out of the anonymous budget per the user's own stance on Predict). The actual anonymous-budget universe is therefore **7 vote-style surfaces** in the codebase: the six the user named, plus a **trending-poll** vote that the Phase 3 wiring treats as distinct. See Section 1 for the full enumeration and `[OPEN_QUESTION]` items.

---

## Section 1 — Auth gate map

### Vote page (`client/src/pages/VotePage.tsx`, route `/vote`, mounted in `client/src/App.tsx:118`)

`[CURRENT]` The page itself is **not** auth-gated. Anonymous users can land on `/vote`, see all cards, scroll, and read everything. Only the *interactive* surfaces gate.

The vote-rate-limit primitive used everywhere is `checkVoteRateLimit(voterId)` at `server/routes.ts:738–752` — **30 votes per 60 seconds** per `voterId`, in-memory map, cleaned every 5 minutes. It is the same primitive for all surfaces below.

| # | Surface | Endpoint | Middleware | Anonymous experience | Rate limit | Anon vote persisted? |
|---|---------|----------|------------|----------------------|------------|---------------------|
| 1 | Sentiment polls | `POST /api/polls/:slug/vote` (`server/routes.ts:12139`) | `requireAuth` | Card renders; click → 401 → toast "Sign in to vote" + `navigateToLogin()` | 30/min/userId | ❌ rejected |
| 2 | Matchup polls | `POST /api/matchups/:id/vote` (`server/routes.ts:5573`) | `optionalAuth` | Card renders; click succeeds; vote persisted with `userId = req.sessionId` | 30/min/voterId (session or user) | ✅ persisted (see Section 2 caveat) |
| 3 | Opinion polls | `POST /api/opinion-polls/:slug/vote` (`server/routes.ts:13100`) | `requireAuth` | Card renders; click → 401 → sign-in toast | 30/min/userId | ❌ rejected |
| 4 | Induction | `POST /api/vote/induction/:id/vote` (`server/routes.ts:17869`) | `requireAuth` | Card renders; click → 401 → sign-in toast | 30/min/userId | ❌ rejected |
| 5 | Value-vote (underrated/fairly/overrated) | `POST /api/celebrity/:id/value-vote` (`server/routes.ts:3307`) | `requireAuth` | Widget renders with community %; click → 401 → toast | 30/min/userId | ❌ rejected |
| 6 | Approval-rating (1–5) | `POST /api/celebrity/:id/approval-rating` (`server/routes.ts:3488`) | `requireAuth` | Slider renders with aggregate; click → 401 → toast (slider reverts) | 30/min/userId | ❌ rejected |
| 7 | Trending-poll vote | `POST /api/trending-polls/:id/vote` (per Phase 3 commit) | `requireAuth` | Same as sentiment polls | 30/min/userId | ❌ rejected |
| 8 | Comment vote (up/down) | `POST /api/comments/:id/vote` (`server/routes.ts:4555`) | `requireAuth` | Buttons show; click → 401 | 30/min/userId | ❌ rejected |
| 9 | Curate image vote | `POST /api/people/:personId/images/:imageId/vote` (`server/routes.ts:2696`) | `requireAuth` | Section renders; click → 401 | 30/min/userId | ❌ rejected |

`[GAP]` The asymmetry the user described is exactly what the code does: **only matchups (#2) bypass `requireAuth`** via `optionalAuth`. Every other vote surface returns 401 to anonymous users and the client renders the standard sign-in toast. A user who votes on a matchup card and then taps the next card (a sentiment poll) is hard-gated — that is the bounce vector the unified model should fix.

`[GAP]` The reads `GET /api/celebrity/:id/value-vote` (`routes.ts:3418`) and `GET /api/celebrity/:id/approval-rating` (`routes.ts:3462`) use `optionalAuth` and return null for the user's own selection when anonymous. Reads are correctly ungated; only writes need treatment.

`[OPEN_QUESTION]` Surfaces #7 (trending-poll vote, distinct hook in Phase 3 wiring) vs #1 (sentiment poll) — confirm whether these are two endpoints or one. The Phase 3 engagement hooks (Section 5 below) treat them as separate sources but the user's brief lumps them under "sentiment polls". This affects the "all 9 surfaces" framing and the (surface_type, target_id) counting unit in Section 4.

`[OPEN_QUESTION]` Are surfaces **#8 (comment vote)** and **#9 (curate image vote)** in or out of the anonymous budget? The user's brief doesn't mention them. Comment voting feels different (signal of taste-on-people-talking-about-people, but hairier with abuse risk). Curate-image voting is a moderation-adjacent action. My Section 4 [PROPOSAL] is to **defer both** — keep them auth-only — so the unified budget covers exactly the seven *opinion-on-content* surfaces.

### Predict page (`client/src/pages/PredictPage.tsx`, route `/predict`)

`[CURRENT]` The page is **not** auth-gated. Anonymous users can browse all market cards, see prices/multipliers, see crowd sentiment, see pool sizes, and tap into detail pages (`/predict/updown/:id`, `/predict/h2h/:id`, `/predict/race/:id`). The credits balance is hidden for anonymous users (`PredictPage.tsx:2578–2586`, wrapped in `{user && (...)}`).

Every bet handler — `handleUpDownSelect`, `handleH2HSelect`, `handleGainerSelect`, `handleEnterJackpot`, `handleCommunityPickEntry` — front-loads the same auth check (`PredictPage.tsx:2009–2013` and four sibling sites):

```ts
if (!user) {
  toast("Sign in required", { description: "Sign in to place predictions." });
  navigateToLogin(setLocation);
  return;
}
```

The `StakeModal` itself is never opened for anonymous users — the toast fires first, before the modal can mount.

`[GAP]` The toast string "Sign in required" / "Sign in to place predictions." is duplicated literally across five handlers. If the user accepts a Predict-specific recommendation (Section 7), this duplication becomes the natural place to inject the unified copy.

`[CURRENT]` `navigateToLogin` (the existing helper at `client/src/lib/authReturn.ts:161–171`) snapshots the current pathname+search+hash into `sessionStorage` and redirects the user back after sign-in (Section 3 details). So the "view a market, tap to bet, sign up, return to that market and try again" flow already works end-to-end for free.

### Celebrity profile pages

`[CURRENT]` Every celebrity-profile interaction follows the same pattern:

- **Reads** — momentum, images, avatar, value-vote percentages, approval rating aggregate — all `optionalAuth` or no auth, anonymous-readable.
- **Writes** — value-vote, approval-rating, sentiment vote, image-vote, comment, comment-vote — all `requireAuth`, 401 to anonymous, sign-in toast on the client.

`[CURRENT]` Profile-view counting (`shouldCountView` at `routes.ts:530–555`) is the **only** place anonymous identity is currently used productively: it deduplicates views per `(sessionId || clientIp, personId)` and rate-limits per IP at 30 views / 10 minutes. This is unrelated to the vote budget but informs the IP-vs-session discussion in Section 4.

---

## Section 2 — Anonymous-user identity mechanism

`[CURRENT]` There are **two parallel anonymous-identity primitives** in the codebase, and they are not connected to each other. This is a meaningful finding — the user's brief assumed a single mechanism.

### Primitive A: the `fdx_sid` UUID cookie

- Constant: `SESSION_COOKIE_NAME = 'fdx_sid'` at `server/routes.ts:488`.
- Reader: `getSessionId(req)` at `server/routes.ts:515–520` — parses the cookie header, returns the UUID or `''`.
- Writer: **only one place** — the `GET /api/trending/:id` profile-detail handler at `server/routes.ts:1261–1272`. If the cookie is missing, a `randomUUID()` is set with `httpOnly`, `sameSite: 'lax'`, `secure` in production, **maxAge 1 year**, `path: '/'`.
- Used in: profile-view dedupe and per-person view rate limit (`shouldCountView` at `routes.ts:530–555`, key `sessionId || clientIp`). **Nothing else.**
- Persistence: across refresh ✓, across browser restart ✓, across incognito ✗ (incognito has its own cookie jar), across devices ✗.

`[GAP]` Because the cookie is only set when a user views a celebrity profile, **a user who lands on `/vote` and never visits `/people/:id` has no cookie at all.** The unified anonymous-budget model needs the cookie to exist on first vote, not on first profile view.

### Primitive B: the synthesised `anon_${IP+UA}` session ID

- Generator: `optionalAuth` middleware at `server/auth-middleware.ts:114–132`. Runs on **every request that uses `optionalAuth`** and unconditionally writes:

  ```ts
  req.sessionId = `anon_${Buffer.from(ip + userAgent).toString('base64').substring(0, 32)}`;
  ```

- It does **not** read the `fdx_sid` cookie. Even if the cookie exists with a stable UUID, `optionalAuth` ignores it and synthesises a fresh hash from IP + User-Agent on every call.
- Used in: matchup-vote attribution (`routes.ts:5576`, `voterId = req.userId || req.sessionId`) and the matchup vote-rate-limit key. The synthesised value is what gets written to `votes.userId` for anonymous matchup votes.

`[GAP]` This is the abuse-vector hole the brief is concerned about.

- The 32-char base64 truncation of `IP + UA` is **deterministic and stable** across calls *within* a session (so the rate limiter works against the same browser tab over the next 60 seconds), **but** it is also brittle:
- Incognito mode → potentially different UA string (some browsers tweak it for privacy) → new sessionId.
- Network change (home Wi-Fi → mobile data) → different IP → new sessionId.
- Two roommates on the same Wi-Fi with the same browser version → same sessionId → one rate-limited bucket shared across two real humans (the shared-household false positive the brief mentions).
- A determined abuser sending a custom `User-Agent` header with each request gets a fresh budget per request.

`[GAP]` Crucially, the matchup unique constraint `(userId, voteType, targetType, targetId)` (Section 4) is keyed off this brittle hash, so a user who clears cookies, gets a new IP, or spoofs the UA can re-vote on the same matchup. This is already true today.

### Primitive C: authenticated identity

`[CURRENT]` Logged-in users authenticate via Supabase JWT in `Authorization: Bearer <token>`. The global rate-limit middleware (`server/index.ts:507–517`) resolves the JWT once per request and populates `req.userId`, which `requireAuth`/`optionalAuth` reuse. There's no first-party session cookie for authenticated users.

### Recommendation

`[PROPOSAL]` For the unified anonymous-budget model, **converge on Primitive A (`fdx_sid`)** and retire Primitive B for vote attribution.

Rationale:

1. The cookie already exists and has the right properties (HttpOnly, 1-year, server-set). The only reason `optionalAuth` synthesises an IP+UA hash is that the cookie isn't guaranteed to exist on every endpoint — but that's fixable.
2. The cookie is meaningfully more resistant to incognito-then-vote-again than IP+UA: opening incognito definitely yields a new cookie jar (so the abuse vector still exists), but at least *clearing cookies* and *changing UA strings* are different attacks. With IP+UA, both are the same attack.
3. A 1-year cookie better reflects the cumulative-budget intent ("you have N votes total, no time window") than a hash that resets every time a user changes networks.

Implementation shape (deferred to the implementation brief):

- Move the cookie-set into a small Express middleware that runs ahead of `optionalAuth` on the routes that need anonymous attribution, so any anonymous user gets a `fdx_sid` cookie on first request — not just on profile-view.
- Have `optionalAuth` read `fdx_sid` first and only fall back to `anon_${IP+UA}` if the cookie is somehow unset (defence-in-depth, not the main path).
- For the budget counter, key off the cookie UUID; use the IP as a secondary signal in Section 4's abuse-mitigation layer rather than as the primary identity.

`[OPEN_QUESTION]` Should we discard the synthesised `anon_${IP+UA}` strings *already written* into `votes.userId` (from prior matchup voting) on rollout? They're orphan rows that won't tie to any real cookie. Cleanest answer: leave them; they aggregate into matchup totals correctly even if no individual user can find their own past votes. But flag for the user.

`[OPEN_QUESTION]` Mobile in-app browsers (Instagram, Twitter, etc.) sometimes do not persist third-party-context cookies. If `/vote` is opened from a Twitter share inside the Twitter in-app browser, will the `fdx_sid` cookie persist for the duration of the session? Worth a manual smoke test before launch — flag for QA, not blocking the design.

---

## Section 3 — Create Account modal

`[CURRENT]` There is **no modal**. The "create account / sign in" UI is a **full page route**:

- File: `client/src/pages/LoginPage.tsx`
- Route: `/login` (with optional `?mode=signup` querystring)

Triggered exclusively via `navigateToLogin()` at `client/src/lib/authReturn.ts:161–171`:

```ts
navigateToLogin(setLocation, opts?: { mode?: "signup"; voteUi?: VoteResumePayload | null });
```

`[CURRENT]` The "return to where I was after sign-in" flow already works:

1. `navigateToLogin()` snapshots `pathname + search + hash` (and an optional Vote-page UI snapshot — overlay state, scroll position) into `sessionStorage` under `voxdex_auth_return_snapshot`.
2. Sets a nav-intent flag (`voxdex_auth_nav_intent = "1"`).
3. Navigates to `/login` or `/login?mode=signup`.
4. After successful sign-in, `redirectAfterLogin()` (`authReturn.ts:104–121`) consumes the snapshot, sanitises the path, and `setLocation(target, { replace: true })`s back. Anti-loop guard rewrites `/login*` targets to `/`.

`[CURRENT]` Triggers across the codebase (39 call sites identified). The salient ones for this work:

- `UserMenu.tsx:417` — explicit Sign In button, signin mode.
- `UserMenu.tsx:421–423` — explicit Create Account button, signup mode.
- `WelcomeModal.tsx:86` — onboarding completion → signup mode.
- `PredictPage.tsx:1832, 1978, 2011, 2045, 2084` — five bet handlers (one per market type).
- `VotePage.tsx:515, 1289, 1534, 1558` — vote failures, including some with `voteUi` snapshot to restore the Vote page exactly.

`[CURRENT]` Toast system is **Sonner** (`from "sonner"`), `<Toaster />` mounted in `App.tsx`. Toasts support an `action` field (button label + onClick) which is how the existing "Sign in to vote" toast (`signInToVoteToast.tsx:17–27`) wires the click-through to `navigateToLogin()`.

`[GAP]` The existing component does **not** support:

- Custom inline messaging (e.g., "You've used your 10 free votes — sign up to keep voting" displayed *inside* the login form).
- A "remaining votes" display.
- Email pre-fill via call-site (only the `/login/verify` "Edit email" return path uses the `?email=` querystring today).

But the brief calls for a **toast** with the exhaustion message — *not* in-form messaging — so the modal-side gap doesn't actually block the proposal. The toast carries the message; the login page itself stays generic.

`[PROPOSAL]` Use the existing `/login` route + `navigateToLogin(setLocation, { mode: "signup" })` unchanged. Reasons:

- It already supports the return-to-URL pattern.
- It already supports signup-mode initial tab.
- The Vote page already passes a `voteUi` snapshot for state restoration (this pattern is reusable for the budget-exhaustion case).
- The toast carries the message; the login page stays generic.

The only small adjacent change is the **toast itself** (a new toast variant for budget exhaustion, distinct from the existing "Sign in to vote" toast that fires on individual gated clicks). See Section 6 for wording.

`[OPEN_QUESTION]` The brief mentions "redirected to the existing Create Account modal with a centred toast." Just to confirm: the user is comfortable that this is a *page navigation*, not a modal overlay, and the "centred toast" is a Sonner toast positioned above the login page? Sonner's default position is top-right; the user may want it centred (`<Toaster position="top-center" />`). Confirm whether that's a Vote-only toast positional override or a global change. Probably not blocking — flag for the implementation brief.

`[OPEN_QUESTION]` On a successful signup *from the budget-exhaustion flow*, should the user be returned to the exact card they tried to vote on (with the vote applied automatically), or just back to `/vote`? The existing `voteUi` snapshot mechanism could probably extend to "queue the pending vote and submit on return", but the brief explicitly says **discard anonymous votes at signup** — so the natural answer is "return to the card position, do not auto-submit". Worth confirming.

---

## Section 4 — Edge cases and abuse vectors

### 4.1 IP-vs-session rate limiting

`[CURRENT]` The codebase already keys the matchup-vote rate limit off the synthesised `anon_${IP+UA}` session ID, not pure IP. Pure-IP rate limiting is reserved for view counting and the global anonymous write limiter (15 req/min, `server/index.ts:549–559`).

`[PROPOSAL]` For the new model, key the **vote budget itself** off the `fdx_sid` cookie (per Section 2), but layer **per-IP secondary rate limits** as a circuit breaker:

- Primary: `fdx_sid` UUID — every anonymous identity gets N total votes (the brief's intent).
- Secondary: per-IP cap of, say, 5×N anonymous votes per 24 hours across all `fdx_sid` UUIDs originating from that IP. This catches the "open 50 incognito windows from one machine" attack without punishing roommates (5×N from one shared Wi-Fi is generous).
- Tertiary: keep the existing 30-vote/60-second per-cookie rate limit as anti-spam.

`[GAP]` Roommate / shared-Wi-Fi false positives exist in the codebase today (the matchup limiter shares a bucket across the household if their browsers happen to send identical UA). Switching the primary key to `fdx_sid` actually **reduces** this false-positive rate because each roommate has their own browser cookie store. The IP-secondary layer above only fires at high volumes.

`[OPEN_QUESTION]` The IP-secondary cap (5×N) is a number I'm pulling out of the air. The user can override; I'd run it through the actual ratio of anonymous-vote-attempts-per-IP from production logs once data exists. For v1 launch with N around 7–10 (Section 5), 5×N = 35–50 anonymous votes per IP per 24h is roughly "a household of five each maxing their budget on the same day, twice over." That's lenient but not a barn door.

### 4.2 Comments

`[CURRENT]` `POST /api/comments` is `requireAuth` (`routes.ts:4360`); `POST /api/comments/:id/vote` is `requireAuth` (`routes.ts:4555`); `POST /api/comments/:id/report` is `requireAuth` (`routes.ts:4730`). Reads (`GET /api/comments`) are `optionalAuth` and anonymous users can read freely.

`[PROPOSAL]` **Keep all comment writes auth-only.** Comments are a higher-abuse surface (free-form text, slander, spam) and the user's brief doesn't request them in the budget. Trying to bring comments under the budget would force decisions about flagging-as-anonymous (heavy moderation cost) and identity-transfer-on-signup that don't pay for themselves at v1. The unified-model's value is on the *taste-signal* surfaces; comments aren't one of them.

`[OPEN_QUESTION]` Comment up/down voting (#8 in Section 1) is a borderline case — it's a taste signal more than free-form content. My recommendation is still defer (auth-only), because (a) the user didn't list it in the proposal, (b) Phase 3 explicitly skips comments and curate-image votes for engagement-blending (per the Phase 3 commit body), (c) comment voting is hairier to display anonymously without revealing some kind of viewer identity. But flag for the user.

### 4.3 Search, filters, scrolling, viewing

`[CURRENT]` All read surfaces — search (`/api/people/search`), momentum, images, avatar, comments, polls, matchups, leaderboards — are `optionalAuth` or no auth. They are correctly ungated. There is no read-side gating to fix.

The only subtle exception: per-person view count is rate-limited to 30 views per IP per 10 minutes (`shouldCountView`, `routes.ts:530–555`) — this is a *server-side analytics* throttle, not a user-visible gate. Anonymous users can keep scrolling; the back-end just stops incrementing the visible counter. Fine for the unified model; no action needed.

### 4.4 Mid-flow limit hits

`[CURRENT]` The limit check happens server-side after the user submits — there is no client-side budget mirror today (because there's no budget today). For value-vote and approval-rating, the existing 401 flow already snaps the client UI back to its prior state (slider reverts, button un-toggles), so the rejection is visually clean.

`[GAP]` For the new model, the worst-feel scenario is: user is at 9/10 votes, drags the approval slider to 4 on Pete Hegseth, taps Submit, server returns "budget exceeded" — and the slider just snaps back. From the user's POV their vote evaporated.

`[PROPOSAL]` Mirror the budget client-side and **render the gate before the action**, not after. Concretely:

- Server returns `budgetUsed` / `budgetLimit` on every authenticated and anonymous request (so the client always knows where it stands).
- Client tracks budget locally and at `budgetUsed >= budgetLimit - 1`, **the next click does not submit** — it directly fires the exhaustion toast and `navigateToLogin(setLocation, { mode: "signup" })`. The vote that "would have been the last one" is never submitted; the user is told upfront that this would push them over. (Alternative: allow that last vote, gate on the *next* click. Both are defensible; allowing-the-last is friendlier.)
- The server-side limit remains, as defence-in-depth — clients can lie about the count.

`[OPEN_QUESTION]` The "last vote applied vs gate before last vote" choice is a UX call. My recommendation is **allow N votes, gate on the (N+1)th attempt** — the user gets every vote in their budget, then a clean stop. The alternative ("you have 1 vote left" → submit → "thanks, you're now signed up to keep going") feels like a bait-and-switch. Confirm.

`[OPEN_QUESTION]` Approval-rating slider drag — does it submit on every drag, on release, or on an explicit confirm? If on drag, the budget is consumed by exploration. Need to either debounce the slider's `onChange` so only the final value submits, or count an entire drag-session as one vote. (This may already be how the code works; flag for the implementation brief to verify.)

### 4.5 The (surface_type, target_id) counting unit

`[CURRENT]` Surfaces are stored across **separate tables** with separate unique constraints (`shared/schema.ts`):

- `userVotes` — approval rating (1–5), unique `(userId, personId)`.
- `celebrityValueVotes` — value-vote (under/over/fair), unique `(userId, celebrityId)`.
- `votes` (polymorphic) — matchups, sentiment, opinion, induction, etc., unique `(userId, voteType, targetType, targetId)`.

So an authenticated user voting on Pete Hegseth's value-vote *and* approval-rating writes two rows in two tables.

`[PROPOSAL]` **Count one unit per (anonymous identity, person)** for value-vote and approval-rating combined. Reasoning, in order:

1. **User mental model.** A user who "voted on Pete Hegseth" has done one act of opining about Pete, even if the UI exposed two widgets. From their perspective, the question they answered is "how do you feel about this person?" — value-vote and approval-rating are two facets of the same answer.
2. **Conversion economics.** The brief is selling N as "N opinions before sign-up," not "N database writes." A user who is told "you have 7 more opinions left" and then realises that voting on one person costs 2 of those opinions feels short-changed. One-per-person matches the marketing.
3. **Phase 3 engagement breadth.** The personalisation ramp counts *distinct categories engaged*, not vote-rows. Pete Hegseth's category is `politics` regardless of how many widgets the user touched on his profile. So counting two-rows-as-one-unit doesn't lose any signal for the post-conversion blended-rank.
4. **Abuse parity.** Counting two-as-two would let anonymous abusers consume budget on 5 people instead of 10, reducing the breadth signal we get from the budget.

The argument *against* is: "value-vote and approval-rating measure different things; they should be priced differently." That's true but doesn't matter at v1 — the budget is a coarse engagement gate, not a signal-quality calibrator.

For non-celebrity surfaces (sentiment poll, opinion poll, matchup, induction, trending poll), the unit is naturally `(surface_type, target_id)` — one vote per poll/matchup/candidate.

`[OPEN_QUESTION]` Two value-vote-and-approval-rating widgets on the same celebrity profile = one budget unit per the proposal above. But what about the user *changing their mind* on a vote (re-voting) — does that consume a second unit? Currently the codebase treats vote-changes as upserts, so the row count doesn't grow. Recommend the budget treats unchanged unit-target pairs as zero-cost (you can flip your value-vote back and forth on Pete without burning budget). Flag for confirmation.

### 4.6 Existing abuse signals

`[CURRENT]` No captcha (no hCaptcha, Turnstile), no client-side device fingerprinting, no canvas/WebGL fingerprint, no behavioural anti-bot. The only abuse signals are:

- IP-based view rate limit (30 views / 10 min / IP) on profile detail.
- Global write rate limit (15 req/min anonymous, 60 req/min authenticated; `server/index.ts:549–559`).
- Vote-specific rate limit (30 votes / 60 sec).
- Bot UA pattern matching (`BOT_UA_PATTERNS`, used only in `shouldCountView`).

`[GAP]` For an anonymous-vote budget at scale, the per-IP secondary cap I proposed in Section 4.1 is the cheapest meaningful addition. A captcha layer on the (N+1)th attempt would be the next layer up if abuse becomes visible. Don't pre-build it — wait for evidence.

---

## Section 5 — Recommend N

The Phase 3 ramp is the fixed point this needs to anchor against.

**Phase 3 ramp summary** (verified in `server/lib/rankingConfig.ts:70–82, 129–136`):

- Floor: **4 distinct categories** → behavioural blend ramp = 0.
- Full: **8 distinct categories** → ramp = 1.0.
- Linear interpolation between (5 → 0.25, 6 → 0.50, 7 → 0.75).
- 12 canonical categories total (`shared/constants.ts:40–52`): tech, politics, business, music, sports, film-tv, gaming, creator, comedy, food-drink, lifestyle, misc.
- Anonymous engagement is **not written to `user_category_engagement`** today (`engagementWriter.ts:98–101`, vote handlers gated by `if (req.userId)`). Anonymous votes don't accumulate signal during the pre-conversion phase — *but* the unified model can change this if we decide to write engagement rows keyed off `fdx_sid` and migrate them at signup. (See `[OPEN_QUESTION]` below.)

### The ramp constraint

A converting user wants the feed to feel personalised on day 1. Two paths get them there:

- **Stated-interest path:** the user picks 1+ stated interest in the onboarding — Phase 3 activates immediately with stated-only blend (`hasBlendSignal()` returns true on stated alone, `blendedRank.ts:384–389`).
- **Behavioural path:** the user accumulates engagement across distinct categories. Below 4 categories, the ramp is 0 — the feed runs on cold-start ranking even though Phase 3 is "on".

If we accept that converting users will be *prompted to pick stated interests* in onboarding (current Welcome flow), then N is unconstrained by the ramp — even N=2 leaves the user with full Phase 3 blend on day 1 *via stated interests*.

But if the user *skips* the stated-interest picker (which the codebase supports), the only way for the post-conversion feed to feel personalised immediately is for the anonymous votes to have already moved them through the ramp. That's only valuable if **anonymous engagement is migrated into `user_category_engagement` at signup** — which the brief explicitly disclaims ("Discard anonymous votes at signup — don't backfill — v1 simplification").

**So the ramp is a soft anchor, not a hard one, for v1.** The user's product call to discard at signup means N's job is *not* to pre-load Phase 3 — it's to reduce bounce and validate that the user wants to engage enough to convert.

### Recommendation

`[PROPOSAL]` **N = 8.**

Reasoning:

1. **Symmetry with the Phase 3 full-blend threshold.** Even though anonymous engagement is discarded at signup in v1, naming N=8 ties the budget conceptually to "how many opinions does it take for our personalisation engine to fully recognise you?" That's a story you can tell internally and externally. If/when the user reverses the discard-at-signup decision (likely in v2 once telemetry justifies it), N=8 gives the converting user full ramp on day 1 with no extra prompts.
2. **Browse-session depth.** Typical engaged-session depth on opinion-driven products (Reddit, Substack reader, BuzzFeed quizzes) is 5–12 actions before a friction event becomes a bounce trigger. N=8 sits at the upper-middle of this band — generous enough to feel like a real free trial, tight enough to convert before the user has signed away their commitment to your brand.
3. **Abuse tail.** With the IP-secondary cap from Section 4.1 (5×N = 40 votes per IP per 24h), N=8 keeps a single IP's effective influence on aggregate vote totals to ≤40 anonymous votes / day. Against a Phase 3 user base of even modest scale, that's noise. At N=20, abuse leverage starts to matter.
4. **Reduces "5 too few, 10 too many" debate to a tied-to-config number.** N=8 is justifiable in one sentence: "matches the Phase 3 distinct-categories full-blend threshold."

**Tunable.** Implement as `ANON_VOTE_BUDGET` env var, default 8, so post-launch tuning is a config push not a deploy. Mirror the convention in `server/lib/rankingConfig.ts` (where `RANK_BEHAVIOUR_RAMP_FULL` defaults to 8 via the same `readNumberEnv` helper).

### Alternatives considered (and rejected)

- **N=5.** Too tight; user only just past the ramp floor of 4. If/when we revisit the discard-at-signup decision, N=5 gives only 25% blend strength on day 1. The conversion effort cost (showing the modal earlier in the session) is not worth it given the bounce-sensitivity at the early-engagement stage.
- **N=10.** Round number, but breaks the symmetry with Phase 3. Hard to justify in one sentence ("we picked 10 because ten is a number") vs. N=8 ("we picked 8 because that's where personalisation peaks").
- **N=12.** Matches the count of canonical categories. Would let an anonymous user theoretically span every category. Too lenient at v1; revisit if abuse data is clean.
- **N=3.** What X (Twitter) does for non-logged-in tweet views. Too tight; the brief is explicitly trying to *reduce* bounce, not match the most aggressive gating in the industry.

### Tying N back to the ramp explicitly

A user who consumes 8 anonymous votes:

- Will have (at most) touched 8 distinct categories — this is the maximum spread.
- Will more typically have touched 3–5 distinct categories (real users cluster around their interests).
- Means **the typical converted user's stated-interest pick is what activates Phase 3 on day 1**, not their pre-conversion votes (which are discarded anyway).
- Means **the long-tail of users who skip the stated-interest picker will fall into cold-start ranking** for some hours/days post-conversion until they engage enough as a logged-in user.

`[OPEN_QUESTION]` This is the spot to revisit the "discard at signup" decision. The argument for keeping discard-at-signup at v1: simpler, no migration logic, no risk of double-counting, no edge cases where a user's anonymous behaviour pollutes their post-signup profile. The argument against: the "anonymous-vote → cold-start logged-in feed" experience is a worse product than the alternative. If telemetry shows new users churning before the post-signup feed feels personalised, **migrating anonymous engagement at signup is the natural v2 lever** — at which point N=8 starts paying off.

---

## Section 6 — Toast wording

Reference points (per the brief) — Spotify, Substack, Reddit. The pattern that converts on these:

- Acknowledge the value the user has already gotten ("we noticed you're enjoying this").
- State the gate matter-of-factly, no nag tone.
- Make the action low-friction ("free", "in seconds").
- Avoid "you've used your X / Y" ledger language — it makes the product feel rationed.

### Three options

**Option A — Honest and warm (closest to Substack's reader prompts):**

> **You've made your voice heard.**
> Create a free account to keep voting and to count toward the rankings.

— Action: `Create account` (signup mode).

**Option B — Simple and direct (closest to Reddit's account-required overlays):**

> **One sec.**
> Sign up free to keep voting — your votes count toward live rankings.

— Action: `Sign up` (signup mode), secondary `Sign in` link.

**Option C — Value-exchange forward (closest to Spotify's "create a free account to keep listening"):**

> **Sign up to keep voting.**
> Create a free account in seconds to record your opinions on VoxDex.

— Action: `Create account` (signup mode).

### Recommendation

`[PROPOSAL]` **Option A.**

Why:

- "You've made your voice heard" frames the budget as *acknowledgement* rather than *limit*. The user did a thing; we noticed; here's what's next. The other options frame it as a stop sign.
- "Keep voting and to count toward the rankings" makes the value-exchange concrete. It's not a generic "sign up to use the app" — it's a specific functional benefit (your opinions become part of the ranking signal). This is the actual value VoxDex offers, told plainly.
- Avoids "free" twice (it's only in the description, not the title), which keeps the title from sounding promotional.
- Action verb "Create account" is consistent with the existing `UserMenu.tsx:421` button label.

`[OPEN_QUESTION]` Should the toast also surface the "your previous votes won't be counted" detail? The brief says discard-at-signup is the v1 simplification, but explicitly disclosing this in the toast may *increase* bounce ("oh, the votes I already made are wasted, why bother"). My recommendation: **don't disclose in the toast.** It's a backend simplification, not a user-facing promise. The user just wants to keep voting.

`[OPEN_QUESTION]` Toast position. Sonner's default is top-right. The brief says "centred toast." Confirm whether this is a position override (`<Toaster position="top-center" />`) for this toast type only, or a global toast position change. Centred toasts feel more modal-like; corner toasts feel more transient. For an action that gates further engagement, centred reads more correctly.

`[OPEN_QUESTION]` Sign-in vs. sign-up emphasis. The toast above primaries `Create account` (signup). For users who already have an account but are browsing logged-out (cleared cookies, new device), they need a `Sign in` path too. Two options:

- Single primary action `Create account`, secondary text link "Already have an account? Sign in."
- Two equal-weight buttons: `Create account` | `Sign in`.

The single-primary version is cleaner and matches the conversion intent (most anonymous users *are* new users); the two-button version is more inclusive of returning users. I'd lean **single primary**, but the user might disagree. Flag.

---

## Section 7 — Predict page recommendation

`[CURRENT]` The Predict page is publicly accessible. Anonymous users browse markets, see odds and pool sizes, tap into detail pages, and only get a sign-in toast when they attempt to bet. Wallet balance is hidden.

The brief's three options:

- (i) **Same as today** — show Predict, toast on bet attempt.
- (ii) **Show Predict but visually disable betting controls** with a clear "sign up to predict" banner.
- (iii) **Redirect anonymous users away from Predict entirely.**

### Reference-point analysis

- **Polymarket** — markets and odds are visible to anonymous users; placing a trade requires connecting a wallet. The bet controls remain visible/clickable; the wallet-connect modal opens on click. Equivalent to (i) with a wallet-connect step instead of a sign-in toast. Their bet rate is high *because* anonymous users can develop a thesis without committing identity first.
- **Kalshi** — similar; markets visible to anonymous, bet flow requires KYC-completed sign-in. Bet controls are visible.
- **Traditional sportsbooks (Bet365, FanDuel, DraftKings)** — odds are public; placing a bet requires a logged-in deposit-funded account. They lean (i) — full visibility, gate at action. Their conversion model depends on the user developing a *picks portfolio* mentally before depositing.

The pattern across all of them: **show everything, gate the action.** The reason is that prediction markets/betting products have a *thesis-formation* phase that happens entirely in the user's head before they care about authentication. Cutting that off — option (iii) — removes the on-ramp.

### Recommendation

`[PROPOSAL]` **Option (i) — keep the current model, refine the toast.**

Reasoning:

1. **Visibility is the product.** Predict's value for an unauthenticated visitor is the *information* — what's trending, what crowd sentiment is, what the implied odds are. That information is the hook; gating it behind a redirect makes the page useless for the discovery audience and removes the "I'd bet on this if I had an account" trigger.
2. **Visual disabling (option ii) loses more than it gains.** Disabled betting controls are visual clutter — they imply state ("nearly there") without function. They typically frustrate more than they convert. The current toast pattern is friendly: nothing looks broken, the user discovered the gate by trying.
3. **Redirecting (option iii) is wrong for this surface.** A user who lands on `/predict` from a share link or a search result and gets bounced to `/login` will assume the whole product is locked. Predict's curated market list is a marketing surface as much as a betting surface.
4. **Aligns with the unified Vote-page proposal.** The Vote page model is "see everything, vote up to N times, then sign up." The Predict page model is "see everything, sign up to bet — no free trial because credits are real economic activity." These are *consistent stances* — visibility-first, action-gated. They differ on *how much* the user can do unauthenticated, but they don't differ on the philosophy.

What I would change about today's Predict gating:

- **Unify the toast wording with Section 6's recommendation.** "Sign in required" / "Sign in to place predictions." reads transactional. Replace with something closer in voice to the new Vote-page exhaustion toast.
- **Consider showing the wallet balance area as a "Sign up to start with X credits" tease**, if there's a signup-credit grant. (Current code: balance area is hidden for anonymous users; `PredictPage.tsx:2578–2586`.)

Tentative replacement copy:

> **Predicting requires a free account.**
> Stake credits, build a track record, and follow the markets you care about.

— Action: `Create account`, secondary `Sign in`.

This frames the gate as a value-exchange ("here's what you get") rather than a denial ("you can't"), and it's consistent in voice with the Vote-page toast.

`[OPEN_QUESTION]` Should anonymous Predict-page visitors get a one-time soft prompt (a banner at the top of the page, dismissible) rather than waiting for them to attempt a bet? Pros: catches users who browse and never click. Cons: friction on the discovery surface, may erode the "everything visible" feel. My recommendation: **don't add a banner.** The discovery experience is the conversion mechanism; a banner gets in its way. Wait for telemetry showing a "browse-but-never-attempt" cohort before optimising for them.

`[OPEN_QUESTION]` Anonymous *favouriting* of markets — currently gated (`PredictDeckView.tsx:735`). Should it remain gated? It's not a real-economic action, it's a personalisation signal. Could be unblocked under the Vote-page model. But it falls outside this investigation's brief — flag and revisit if the user wants a Phase 3b "anonymous personalisation" loop.

`[OPEN_QUESTION]` Anonymous detail-page deep-link experience — `/predict/updown/:marketId` etc. are accessible to anonymous users. After they hit the bet gate, `navigateToLogin()` does already preserve the URL and bring them back. Confirmed working. But consider whether the *post-signup return* should auto-open the StakeModal for the market they just tried to bet on. Currently it returns them to the page; they have to click again. Could be a small UX win — defer to implementation brief.

---

## High-level findings (TL;DR for chat)

The investigation surfaced four meaningful items the brief didn't anticipate:

1. **Two parallel anonymous-identity primitives exist and aren't connected.** A 1-year `fdx_sid` UUID cookie (`server/routes.ts:488,515,1261`) is set only on profile-detail GET and used only for view dedupe. A separate `anon_${IP+UA}` synthesised hash (`server/auth-middleware.ts:114–132`) is used for matchup-vote attribution and never reads the cookie. Section 2 recommends converging on the cookie.
2. **The "9 surfaces" framing has noise in it.** The codebase has 7 vote-style write hooks plus 2 prediction-bet hooks. The brief lists 6 vote-style surfaces; trending-poll vote (#7) is a Phase 3 hook the brief doesn't mention. Comment-vote and curate-image-vote (#8, #9) are vote-shaped surfaces the brief also doesn't mention. Section 1 enumerates all of them and Section 4 recommends keeping comments and curate out of the budget.
3. **The "Create Account modal" is actually a full-page route** (`/login`) — not a modal. Existing `navigateToLogin()` helper supports return-to-URL and signup mode. Section 3 confirms the existing component can serve the budget-exhaustion flow with no modifications — the toast carries the message.
4. **N = 8** ties cleanly to the Phase 3 distinct-category full-blend threshold. Section 5 explains why this is a soft rather than hard anchor (the brief's discard-at-signup choice means anonymous votes don't pre-load Phase 3 in v1) and proposes N=8 as both ramp-aligned and session-depth-appropriate.

Plus one structural recommendation across sections: **mirror the budget client-side** so the gate fires on click, not after server rejection — avoids the "drag slider, tap submit, slider reverts" mid-flow pain. Server-side limit stays as defence-in-depth.

---

*End of findings document. No implementation brief proposed; recommendations are paused pending product decisions on the open questions in each section.*
