# Phase 4 — Manual test checklist

Canonical manual-test doc for the anonymous-voting-budget feature.
Covers four scopes:

- **Stage 6** — pre-signup context modal (variants, dismissal paths,
  popstate, accessibility, responsiveness).
- **Stage 7** — end-to-end gate flow + redirectAfterLogin across the
  11 vote-eligible surfaces and PredictPage signup prompts.
- **Post-deploy verification** — production smoke after each push to
  prod.
- **Post-merge to main verification** — final confidence pass once
  the branch lands on `main`.

Stage 8 automated test coverage was deferred — see "Phase 4a follow-ups"
in `anonymous-voting-implementation.md` for the rationale.

## Setup

- [ ] Apply pending migrations to dev DB: `npm run db:deploy-migrate`
      — only needed when new migration files have been added since your
      last run; the runner is a no-op when `schema_migrations` is up to
      date. (See Phase 4a follow-up in `anonymous-voting-implementation.md`
      for the discovery context.)
- [ ] `npm run dev` (root)
- [ ] Open Chrome / Firefox at the dev server URL with DevTools open
- [ ] Have the Elements panel ready for `data-testid` lookup if needed

Useful test IDs baked into the modal:
- `modal-signup-reason` — root content
- `button-signup-reason-dismiss` — X button (top-right)
- `button-signup-reason-primary` — Create account
- `button-signup-reason-secondary` — Already have an account?

---

## 1. Direct visit `/login?reason=vote_limit_reached` (cyan variant)

- [ ] Modal renders centred over LoginPage
- [ ] Heading reads exactly: **"You're getting into it."**
- [ ] Body reads exactly: **"Create a free account to keep voting and start contributing to the rankings."**
- [ ] Primary button reads **"Create account"** with cyan-500 background
- [ ] Subtext below primary reads **"Free forever. No credit card."**
- [ ] Secondary link reads **"Already have an account? Sign in."**
- [ ] X button visible top-right
- [ ] Click X → modal dismisses, URL becomes `/login` (no `?reason=`)
- [ ] Re-visit URL → modal reappears
- [ ] Press ESC → modal dismisses, URL clears to `/login`
- [ ] Re-visit URL → modal reappears
- [ ] Click on backdrop (outside the modal box) → modal dismisses, URL clears to `/login`
- [ ] Hard refresh on `/login` (no query) → no modal renders

## 2. Direct visit `/login?reason=predict_signup` (violet variant)

- [ ] Modal renders centred over LoginPage
- [ ] Heading reads exactly: **"Predicting needs an account."**
- [ ] Body reads exactly: **"Create a free account to start predicting and build your track record."**
- [ ] Primary button reads **"Create account"** with violet-500 background
- [ ] Subtext below primary reads **"Free forever. No credit card."**
- [ ] Secondary link reads **"Already have an account? Sign in."**
- [ ] X / ESC / backdrop-click all dismiss; URL clears each time
- [ ] Refresh on `/login` shows no modal

## 3. Combined `?mode=signup&reason=vote_limit_reached`

This is the URL `navigateToLogin({mode: "signup", reason: ...})` produces
when Stage 7's voteGate-driven flow lands the user on /login.

- [ ] Visit `/login?mode=signup&reason=vote_limit_reached`
- [ ] LoginPage card title reads **"Create your account"** (signup mode active beneath modal)
- [ ] Modal renders over the signup form
- [ ] Dismiss via any path (X / ESC / backdrop / either CTA)
- [ ] URL becomes `/login?mode=signup` — `reason` cleared, `mode` preserved
- [ ] LoginPage stays in signup mode after dismiss

## 4. Primary CTA — "Create account"

Start state can be either `/login?reason=vote_limit_reached` (default
`isLogin = true`, sign-in mode) or `/login?mode=signup&reason=...`.

- [ ] Open modal via either URL
- [ ] Click primary "Create account" button
- [ ] Modal dismisses
- [ ] LoginPage card title reads **"Create your account"** (signup mode)
- [ ] Submit button reads **"Create account"** (signup-mode label)
- [ ] Email input has focus (visible focus ring; cursor in field)
- [ ] URL no longer contains `?reason=`

## 5. Secondary CTA — "Already have an account? Sign in."

- [ ] Visit `/login?reason=vote_limit_reached` (no `mode=signup`, defaults to sign-in mode)
- [ ] Modal renders
- [ ] Click secondary "Already have an account? Sign in." link
- [ ] Modal dismisses
- [ ] LoginPage card title reads **"Welcome back"** (sign-in mode)
- [ ] Submit button reads **"Sign in"** (sign-in mode label)
- [ ] Email input has focus
- [ ] URL no longer contains `?reason=`

## 6. Browser back/forward popstate sync

Two sub-tests cover the popstate handler.

**6a. History-aware modal toggle:**

- [ ] Visit `/login` (no modal)
- [ ] In address bar, navigate to `/login?reason=vote_limit_reached` (creates new history entry)
- [ ] Modal renders
- [ ] Browser back button → URL becomes `/login`, modal dismisses (popstate handler picks up cleared reason)
- [ ] Browser forward button → URL returns to `/login?reason=vote_limit_reached`, modal reappears

**6b. Dismiss-via-replaceState doesn't pollute history:**

- [ ] Navigate from another page (e.g. `/vote`) to `/login?reason=vote_limit_reached`
- [ ] Dismiss modal via X
- [ ] Browser back button → goes back to `/vote` (NOT `/login?reason=...`)
- [ ] This verifies dismissReason used `replaceState` (no extra history entry created on dismiss)

## 7. Invalid `?reason=` value

- [ ] Visit `/login?reason=foobar`
- [ ] No modal renders
- [ ] LoginPage form renders normally
- [ ] No console errors / warnings

## 8. Backdrop visual

- [ ] Modal open at `/login?reason=vote_limit_reached`
- [ ] Page content visible through backdrop (LoginPage form silhouette / VoxDex logo) — not opaque
- [ ] Backdrop is lighter than typical shadcn modals (the `bg-black/50` override vs the `bg-black/80` default)
- [ ] Backdrop has visible blur — text behind backdrop is illegible / blurred, not just darkened
- [ ] Modal content itself is sharp (only the backdrop is blurred)

## 9. Mobile responsive (375px viewport)

DevTools → Toggle device toolbar → iPhone SE (375 × 667).

- [ ] Modal fits within 375px viewport with comfortable margins
- [ ] No horizontal scroll on body or modal
- [ ] Primary button is full-width inside modal
- [ ] Primary button height ≥ 44px (inspect element → check computed `height`)
- [ ] Heading and body text are readable, not truncated or wrapped awkwardly
- [ ] X button reachable with thumb (top-right, not flush against viewport edge)
- [ ] Backdrop covers entire viewport (no gaps top/bottom)

Test at 320px (iPhone 5 / older) too:

- [ ] Modal still readable, primary button usable

## 10. prefers-reduced-motion

DevTools → Rendering panel (three-dot menu → More tools → Rendering)
→ scroll to "Emulate CSS media feature prefers-reduced-motion" → set
to `reduce`.

- [ ] Visit `/login?reason=vote_limit_reached`
- [ ] Modal appears with no entrance animation (or significantly reduced — fade is near-instant or absent, no zoom-95 → 100 scaling)
- [ ] Modal is still functional — all dismissal paths work
- [ ] Set back to "no preference" → entrance animation visible again on next mount

## 11. Screen reader (VoiceOver on macOS or NVDA on Windows)

- VoiceOver: Cmd+F5 to enable.
- NVDA: Insert+N to access menu, or Ctrl to silence as needed.

- [ ] Visit `/login?reason=vote_limit_reached`
- [ ] Screen reader announces the modal heading on mount (e.g. "You're getting into it., heading" or similar)
- [ ] Screen reader announces the body text via aria-describedby
- [ ] Screen reader identifies the dialog as modal (e.g. "dialog, modal" / "Web dialog")
- [ ] Tab key cycles through interactive elements within the modal: X button → primary CTA → secondary CTA → back to X (focus trap)
- [ ] Shift+Tab cycles backward through the same elements
- [ ] Background page content is NOT reachable via Tab while modal is open
- [ ] ESC dismisses modal; focus moves to email input on LoginPage; screen reader announces "Email, edit text" (or similar)

---

## Stage 6 Sign-off

- [ ] All 11 sections passed
- [ ] Any noted issues filed as Phase 4a follow-ups in
      `docs/investigations/anonymous-voting-implementation.md` under
      "Phase 4a follow-ups" rather than blocking Stage 7

---

## Stage 7 — End-to-end gate flow + redirectAfterLogin

Run after the Stage 6 checklist passes. Verifies the per-surface
voteGate wiring + redirectAfterLogin's resumeAction consumption end-
to-end: gate triggers correctly at the budget cap, modal renders
contextually, post-signup return lands on the originally-attempted
card.

**Phase 4a deferred items (do NOT test as failures):**

- Per-surface auto-open consumers (the "trigger the originally-
  attempted action on mount" half of D9) are NOT wired in Stage 7.
  After signup, the user lands on the right cardRoute but must
  re-click the vote button. This is expected.
- Embedded widget gating (`UnderratedOverratedCard`,
  `OverratedUnderratedWidget`, `ValueVoteModal`,
  `InductionLeaderboardSlice`) was skipped — host pages gate the
  entry. Flagged here for sanity check during testing.

### Setup (Stage 7)

- [ ] Use a fresh incognito / private browser window for each surface
      to start with a clean fdx_sid (no prior anon-budget state). Or
      clear cookies + sessionStorage between surfaces.
- [ ] Test with `ANON_VOTE_BUDGET=8` (default).
- [ ] Have the network tab open to verify GET /api/anon-budget and
      vote POSTs.

### Locked 5-step pattern (per gated surface)

**Step 1 — Anon, no prior votes:** Trigger vote → succeeds, response
budget shows `used: 1`.

**Step 2 — Anon at 7/8 budget:** One more vote on this surface →
succeeds, response shows `used: 8 / remaining: 0 / exhausted: true`.

**Step 3 — Anon at 8/8 (exhausted):** One more attempt → no POST,
redirect to `/login?mode=signup&reason=vote_limit_reached`, Variant A
modal renders.

**Step 4 — Sign up from modal:** Complete flow → land on `cardRoute`.
Phase 4a deferred: vote button is NOT auto-pressed (expected).

**Step 5 — Authed user:** Vote always proceeds, response `budget: null`.

### Per-surface gate flow — 11 surfaces

#### Surface 1 — VotePage induction

- **Trigger:** Click "Vote to Induct" on a candidate card (induction
  overlay or snap-scroll section).
- **cardRoute:** `/vote`
- **pendingVote payload:** `{ intent: "induct" }`
- [ ] Step 1 passes.
- [ ] Step 2 passes.
- [ ] Step 3 passes.
- [ ] Step 4 passes (lands on `/vote`, vote NOT auto-pressed).
- [ ] Step 5 passes.

#### Surface 2 — VotePage matchup

- **Trigger:** Click `option_a` / `option_b` / `neutral` on a Matchup
  card on `/vote`.
- **cardRoute:** `/vote`
- **pendingVote payload:** `{ matchupId, option }`
- [ ] All 5 steps pass.

#### Surface 3 — VotePage discourse (trending poll)

- **Trigger:** Click `support` / `neutral` / `oppose` on a discourse
  topic card on `/vote`.
- **cardRoute:** `/vote`
- **pendingVote payload:** `{ choice }`
- [ ] All 5 steps pass.

#### Surface 4 — VoteDeckView induction (home deck)

- **Trigger:** Click "Vote to Induct" on a home-deck induction card
  (HomePage `/`).
- **cardRoute:** `/`
- **pendingVote payload:** `{ intent: "induct" }`
- [ ] All 5 steps pass.
- [ ] Verify pre-Stage-7 anon-block has been removed: anon users with
      budget remaining can vote without redirect (Stage 4 anon-vote
      feature was previously inaccessible from this surface).

#### Surface 5 — VoteDeckView value-vote (home deck)

- **Trigger:** Click "Underrated" / "Overrated" on a home-deck Value
  card (HomePage `/`).
- **cardRoute:** `/`
- **pendingVote payload:** `{ vote: "underrated" | "overrated" }`
- [ ] All 5 steps pass.

#### Surface 6 — AnimatedSentimentVotingWidget (approval-rating)

- **Trigger:** Click "Submit Your Vote" with a 1-5 rating selected,
  on a person profile (`/person/<slug>`).
- **cardRoute:** `/person/<slug>`
- **pendingVote payload:** `{ rating: 1..5 }`
- [ ] All 5 steps pass.
- [ ] Verify pre-Stage-7 anon-localStorage-only flow has been
      removed: anon votes now persist server-side (within budget).
      Optimistic localStorage update still fires via onMutate.

#### Surface 7 — MatchupDetailPage matchup

- **Trigger:** Click `option_a` / `option_b` / `neutral` button on
  the matchup detail page (`/matchup/<slug>`).
- **cardRoute:** `/matchup/<slug>`
- **pendingVote payload:** `{ option }`
- [ ] All 5 steps pass.
- [ ] Bonus: anon user with prior vote remove path — succeeds (anon
      removes are allowed per Stage 4 server behaviour).

#### Surface 8 — PersonDetailPage matchup

- **Trigger:** Click matchup vote button on the Person detail page's
  Vote tab (`/person/<slug>`, embedded matchups featuring this
  person).
- **cardRoute:** `/person/<slug>`
- **pendingVote payload:** `{ matchupId, option }` (page hosts
  multiple matchups, both fields needed).
- [ ] All 5 steps pass.
- [ ] Bonus: anon user remove path — succeeds (Stage 7 dropped the
      auth-block on `handleMatchupRemoveVote`).

#### Surface 9 — PollDetailPage trending poll

- **Trigger:** Click `support` / `neutral` / `oppose` button on the
  poll detail page (`/polls/<slug>`).
- **cardRoute:** `/polls/<slug>`
- **pendingVote payload:** `{ choice }`
- [ ] All 5 steps pass.

#### Surface 10 — OpinionPollDetailPage opinion poll (3 sub-flows)

- **Trigger location:** `/opinion-polls/<slug>`
- **cardRoute:** `/opinion-polls/<slug>`

**10a. Fresh-vote (no prior vote on this poll):**

- **pendingVote payload:** `{ kind: "vote", optionId }`
- [ ] All 5 steps pass.

**10b. Change-vote (prior vote exists):**

- [ ] Anon with prior vote, within budget: click a different option →
      confirmation dialog opens → confirm → vote changes successfully
      (free upsert under D3). No gate needed.
- [ ] Anon at exhausted budget changing vote: same flow succeeds (D3
      upsert is always free; gate is bypassed for change-vote per
      Stage 7's auth-block drop).

**10c. Remove-vote:**

- [ ] Anon with prior vote: click "Remove vote" → succeeds (no budget
      cost, auth-block dropped).

#### Surface 11 — InductionQueuePage induction

- **Trigger:** Click vote button on a candidate card on the induction
  queue page (`/induction-queue` or similar entry).
- **cardRoute:** `/induction-queue`
- **pendingVote payload:** `{ intent: "induct" }`
- [ ] All 5 steps pass.

### PredictPage signup prompts (no budget gate)

PredictPage has no anon-budget surface. All 13 auth-required entry
points should redirect with `reason=predict_signup` and render the
**Variant B** modal (violet accent, "Predicting needs an account.").

#### Mutation handlers (5 toast-replacement sites)

For each, while signed out, trigger the action:

- [ ] `handleEnterJackpot` — click "Enter Jackpot" with a person
      selected.
- [ ] `handleCommunityPickEntry` — click yes/no on a community
      market entry.
- [ ] `handleUpDownSelect` — click up/down on a weekly UpDown card.
- [ ] `handleH2HSelect` — click a person on a Head-to-Head card.
- [ ] `handleGainerSelect` — click a candidate on a Top Gainer card.

For each: redirects to `/login?mode=signup&reason=predict_signup`,
Variant B modal renders, **no toast**.

#### onAuthRequired callbacks (8 sites)

While signed out, hit each entry point that triggers `onAuthRequired`:

- [ ] community section header (line ~2759)
- [ ] updown section header (line ~3012)
- [ ] section header (line ~3113)
- [ ] section header (line ~3220)
- [ ] FullScreenOverlay community (line ~3299)
- [ ] FullScreenOverlay updown (line ~3334)
- [ ] FullScreenOverlay h2h (line ~3380)
- [ ] FullScreenOverlay gainers (line ~3415)

For each: redirects to `/login?mode=signup&reason=predict_signup`,
Variant B modal renders.

### Cross-cutting checks

#### D2 unification (celebrity_person)

Anon user with fresh budget:

- [ ] Cast approval-rating on Person X (consumes 1 budget unit).
- [ ] Then cast value-vote on same Person X (different surface
      action, same celebrity_person target_id).
- [ ] Server response on second action: `consumed: false`,
      `budget.used: 1` (unchanged).
- [ ] Budget cache reflects 1 unit consumed total, not 2.

#### Browser back from /login

Anon user hits gate → redirects to /login → user dismisses without
signing up:

- [ ] Modal renders.
- [ ] Click X / ESC / click outside to dismiss.
- [ ] URL clears `?reason=` (page stays at /login).
- [ ] Click browser back button.
- [ ] Browser returns to the original surface URL.
- [ ] Vote button is in the same state (clickable, not stuck in a
      submitted state).
- [ ] Clicking the vote button again re-triggers the gate.

#### Phase 4a deferred (per-surface auto-open)

For each detail page (matchup, person, opinion-poll, induction-queue,
poll), after post-signup return:

- [ ] User is on the correct cardRoute URL.
- [ ] Vote button is in default state (NOT auto-pressed).
- [ ] User can click it manually to complete the vote.
- [ ] This is the **expected** Phase 4a deferral state.

#### Embedded widget sanity check

These were skipped during Stage 7 (host page covers the entry):

- [ ] `UnderratedOverratedCard` — only renders inside pages that
      already gate. Verify no anon-vote attempt reaches the server
      bypassing the host page's gate.
- [ ] `OverratedUnderratedWidget` — same.
- [ ] `ValueVoteModal` — same.
- [ ] `InductionLeaderboardSlice` — same.

If any embedded widget triggers a vote that bypasses the host's gate,
flag as a Stage 8 manual-verification finding for Phase 4a inclusion.

## Stage 7 Sign-off

- [ ] All 11 per-surface gate flows passed (Surfaces 1-11).
- [ ] PredictPage signup-prompt flows passed (5 mutation handlers +
      8 onAuthRequired callbacks = 13 sites).
- [ ] D2 unification verified.
- [ ] Browser-back behaviour verified.
- [ ] Phase 4a deferred items confirmed expected (not blocking).
- [ ] Embedded widget sanity check passed.

---

## Post-deploy verification (production smoke)

After each push to production, run through the brief's manual
verification post-deploy items (`anonymous-voting-implementation.md`
lines 268-283). Verbatim:

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

---

## Post-merge to main verification

Once `feat/anonymous-voting-budget` merges into `main`, run the
brief's verification checklist (`anonymous-voting-implementation.md`
lines 303-317). Verbatim:

1. Migration 0049_anon_vote_budget row in schema_migrations.
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
