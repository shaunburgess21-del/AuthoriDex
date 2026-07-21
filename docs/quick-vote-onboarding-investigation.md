# Quick Vote / Starter Mix Onboarding Overlay — Investigation Report

Investigation only. No code was changed. Date: 2026-07-21.

Scope: feasibility of a first-visit "Quick Vote" overlay (glass backdrop, snap-scrolling
live-mirror vote cards, curated cross-category sequence) plus a contextual nudge system,
per the seven investigation areas briefed.

---

## Executive summary

- **The foundation is stronger than assumed in some places and weaker in others.**
  `VoteSnapScrollView` is already a prop-driven, full-screen, snap-scrolling overlay with
  `renderCard` injection, `commentMode="none"`, horizontal category paging, windowed
  mounting, and image warming. A "minimal mode" is a small props delta, not a fork.
- **The single biggest technical risk is vote-state mirroring, and it is not solved by
  "same components".** Only 2 of 6 card types (Opinion, Curate) are true TanStack-cache
  mirrors today. Matchups and Induction keep voted-state in `VotePage`-local React state;
  Sentiment is invalidate-only; Value (Overrated/Underrated) has a broken mirror (wrong
  query key + no prop sync). Any overlay mounted outside `VotePage` requires lifting this
  state into the query cache first.
- **Two of the six proposed wheel categories are not anonymous-votable today.** Profile
  image curation is `requireAuth` on the server; Overrated/Underrated is auth-gated in
  the client UI (sign-in toast) even though the server would accept anon votes. An anon
  first-visit wheel realistically has 4 categories (Sentiment, Matchups, Opinion,
  Induction) unless this changes.
- **You cannot currently measure the thing you are trying to fix.** There is no bounce
  metric, no overlay-open events, no votes-per-session, and no signup funnel attribution.
  GA4 emits `page_view` only; the server has `page_views` + `fdx_sid` and an
  `insights_events` pattern that could be extended. A thin funnel-event layer should be a
  prerequisite (or parallel workstream), or the feature's impact will be unmeasurable.
- **Signup-return infrastructure already exists and fits the wheel almost perfectly.**
  `authReturn.ts` snapshots (`VoteResumePayload` already persists snap state through
  login/onboarding) plus `useAnonBudget` (exposes `used/limit/remaining/exhausted` for a
  "3/8" indicator) cover most of area 3 and 4 with small extensions.
- **No cross-category feed exists; content volume is ample.** A starter mix needs either
  a small `starter_mix_items` table + one endpoint, or a no-migration v1 heuristic
  composed from existing per-type endpoints.

---

## Challenges to the original strategic assessment (Claude web)

The phasing recommendation (nudges first, wheel second) survives this investigation and
is in fact strengthened by it. But several load-bearing claims need correction:

1. **"Your existing Swiper.js snap-scroll feed" — wrong engine.** Snap view does not use
   Swiper. It is native CSS scroll-snap (vertical) + a custom Framer Motion pan
   (horizontal category paging). Swiper is used in the *section carousels* on the vote
   hub (`MobileCardCarousel`, `CurateSection`). This doesn't change the conclusion but
   the implementation surface is different from what was described.

2. **"Same components, same vote mutations, so the mirror concern disappears entirely" —
   overstated.** It disappears for Opinion and Curate. It does *not* for Matchups
   (voted state lives in `VotePage`'s `localMatchupVotes` state), Induction (`votedIds`
   Set in `VotePage`), Sentiment (no optimistic list patch on the hub; percents update
   only after refetch), or Value (card-local mutation invalidates
   `['/api/leaderboard']`, which does **not** match the hub's literal key
   `['/api/leaderboard?tab=value&limit=100']`, and the card never re-syncs `localVote`
   from props). The existing snap view gets away with this because it is rendered
   *inside VotePage* and shares its handlers. A first-visit overlay mounted on the
   landing page cannot.

3. **"The SignupReasonModal renders inside the wheel context rather than ejecting them" —
   not how it works today.** `SignupReasonModal` is LoginPage-local (rendered only when
   `/login?reason=vote_limit_reached`). The current exhaustion flow deliberately
   *navigates away* to `/login`, and the auth-return snapshot restores UI state
   afterwards. Rendering the modal inside the wheel is possible (it portals to
   `document.body`) but is a rework of the established flow, not a default. The
   codebase-consistent design is: extend `VoteResumePayload` with wheel state, keep the
   navigate-to-login flow, and restore the wheel post-onboarding — which the existing
   `redirectAfterLogin` → `AUTH_APPLY_VOTE_UI_ONCE_KEY` machinery already does for snap
   view.

4. **Missed: snap view is mobile-only.** Every open site is gated `if (!isMobile) return`.
   A desktop wheel is net-new layout work (desktop first-visitors currently get grids,
   not snap feeds). Product decision required: mobile-only v1, or desktop variant.

5. **Missed: first-visit interrupt collision.** HomePage already mounts `WelcomeModal`
   (`voxdex_seen_intro`), the vote hub has `OnboardingDrawer` + first-visit toast
   (`authoridex_vote_welcome_seen`), and there are referral (`ReferralPromptGate`) and
   interests (`InterestsGate`) prompts. A new entry nudge is the *fifth* first-session
   interrupt candidate. Without a central arbiter, a new visitor could plausibly see
   WelcomeModal → wheel nudge → referral prompt in one session — the exact popup-fatigue
   failure mode the feature is meant to avoid. Consolidation is a required design input,
   not an optional polish item.

6. **Missed: the anon-votability gaps** (Curate is `requireAuth`; Value is client
   auth-gated). The "8-vote budget as the wheel's secret weapon" framing is right, but
   the wheel's category list must be trimmed or those surfaces changed.

7. **"Trigger on ~6–8s dwell or first scroll" — currently unmeasurable.** With no
   analytics beyond GA4 page views, there is no data on when users bounce, from which
   page, or on which device class. The trigger heuristics are reasonable defaults, but
   instrumentation should land first so the trigger can be tuned on evidence.

---

## Area 1 — Card component reusability

### How `/vote` is composed

One mega-page (`client/src/pages/VotePage.tsx`, ~200 KB). All section data fetching and
most vote handlers live at page level. Cards render inside a shared `CardSection`
(desktop grid / mobile Swiper carousel). Snap view mounts six per-section
`VoteSnapScrollView` instances as page siblings, reusing the same cards and handlers —
this is the existing "live mirror overlay" precedent.

### Per-card coupling map

| Card | Component | Extracted? | Mutation owner | True cache mirror from an external overlay? |
|---|---|---|---|---|
| Sentiment | `DiscourseCard` | **No** (local in `VotePage.tsx` ~854–1145) | `VotePage` (`handleDiscourseVote` → `POST /api/polls/:slug/vote`, invalidates `['/api/trending-polls']`) | Partial — reflects after refetch; no optimistic list patch on hub |
| Matchups | `VersusCard` (`components/matchups/VersusCard.tsx`) | Yes | `VotePage` (`handleMatchupVote`, invalidates `['/api/matchups']` + user-votes) | **No** — voted side lives in `VotePage` state `localMatchupVotes`; external overlay would not share it |
| Opinion | `OpinionPollCard` (`components/opinion-polls/OpinionPollCard.tsx`) | Yes | Shared hook `useOpinionPollVoteMutation` — optimistic `setQueryData` on `['/api/opinion-polls']` | **Yes** — best case; reuse as-is |
| Overrated/Underrated | `UnderratedOverratedCard` | Yes | Card-local mutation | **Broken** — invalidates `['/api/leaderboard']` which doesn't match the hub key `['/api/leaderboard?tab=value&limit=100']`; `localVote` never re-syncs from `person.userValueVote` |
| Induction | `InductionCandidateCard` | **No** (local in `VotePage.tsx` ~405–572) | `VotePage` (`inductionVoteMutation`, optimistic `votedIds` Set) | **No** — `votedIds` is page state; also needs section-relative `rank`/`maxVotes` inputs |
| Curate | `CurateProfileCard` (`components/curate/CurateProfileCard.tsx`) | Yes | Card-local, optimistic patch on `['/api/people', id, 'images']` | **Yes** — but anon cannot vote (see Area 3) |

### Refactor surface for true mirroring

- Extract `DiscourseCard` and `InductionCandidateCard` from `VotePage.tsx`.
- Lift matchup voted-state out of `localMatchupVotes` into the query cache (optimistic
  patch of `['/api/matchups']` + `['/api/matchups/user-votes']`, the pattern
  `MatchupDetailPage` already uses via `optimisticMatchupVotePatch`).
- Same for induction `votedIds` (derive from `['/api/me/induction-votes']` with an
  optimistic patch).
- Fix the Value card's invalidation key and add a `useEffect` syncing `localVote` from
  props (this is arguably a latent bug on the hub today: two Value card instances —
  grid + snap — can already disagree).
- Add an optimistic list patch for sentiment (parity with `PollDetailPage`'s
  `optimisticSentimentVotePatch`) if instant cross-surface reflection is wanted.

Auto-advance after vote is **section-level**, not card-level
(`playInactiveVoteAdvance` → `CardSectionHandle.playVoteAdvance`, 900 ms dwell then
`slideNext`). Snap view has no auto-advance. A wheel auto-advance is therefore a new,
overlay-shell-level behavior — free to design per UX preference.

---

## Area 2 — Snap view / snap scroll

### What exists

`client/src/components/snap-scroll/VoteSnapScrollView.tsx` (~950 lines):

- **Mount:** fixed full-screen overlay (`fixed inset-0 z-[60] bg-background`), rendered
  as a sibling inside `VotePage` (6 instances) and `PredictPage` (2 instances),
  **mobile-only** at every open site. Not a route; browser Back closes via
  `history.pushState({ overlay })`.
- **Vertical:** native CSS scroll-snap, page height `calc(100dvh - 52px)`; windowed
  mounting (`VERTICAL_BUFFER = 1` → ~3 cards with content, empty stub pages hold snap
  positions).
- **Horizontal:** custom Framer Motion pan between *category* columns (3-wide window,
  30%-of-viewport or 500 px/s commit, rubber-band edges), plus `CategoryTabStrip`.
- **Comments:** inline bottom-half sash (not Vaul); `commentMode: "card" | "person" |
  "none"` — `"none"` already ships (induction).
- **Cards:** injected via `renderCard(item, ctx)` render prop; `ctx.priority` drives
  eager image loading; per-column image warming.
- **Entry sources:** typed `SnapOpenSource = "browse-button" | "header-icon"` (the
  briefed "end_card"/"section_header" strings do not exist; `SnapEndCard` is an in-feed
  terminal page, not an entry point). Entry source is behavioral only — never logged.

### Reuse vs fork — recommendation

**Extend with a variant, do not fork.** Hardcoded bits that need props/variant:

| Quick Vote requirement | Current state | Delta |
|---|---|---|
| Hide category tab strip | Always rendered | prop |
| Glass backdrop over page | Opaque `bg-background` | shell class swap (`bg-black/40 backdrop-blur-*` patterns already exist: Vaul modals, view-all overlays) |
| X close (top right) | ArrowLeft top-left | prop |
| No end card | Always appended | prop |
| Elevated card chrome | Plain `max-w-lg` wrapper | wrapper class in the `commentMode="none"` branch |
| Desktop support | Mobile-only gates at call sites | **net-new work** (gating is caller-side, but layout assumes mobile viewport) |
| Cross-*section* horizontal axis | Horizontal = categories within one section type | see below |

Estimated scope: the shell variant itself is ~1–2 days. The horizontal-axis question is
the real design fork:

- **(a) Single mixed vertical column (recommended v1):** one `VoteSnapScrollView`-variant
  instance fed a curated `SnapItem[]` mixing types, `renderCard` branching on item type.
  No horizontal axis at all. Lowest learning cost for a first-time visitor (one gesture:
  swipe up), lowest build cost, and consistent with the "curated starter mix, not raw
  section order" strategy. The category-tabs machinery is simply hidden.
- **(b) Horizontal = vote sections:** either an outer horizontal pager of per-type
  instances, or repurpose the category-pan machinery so columns = section types. More
  faithful to the original "wheel" concept, meaningfully more work, and adds a second
  gesture for a user who hasn't learned the first one yet. Better as v2 if data shows
  users exhausting the mix and wanting to pick a lane.

Performance: windowing + warming already handle the feed case; card images go through
`getDisplayImageUrl` (Supabase render transforms only when
`VITE_SUPABASE_IMAGE_TRANSFORM === "true"`, otherwise raw public URLs — worth confirming
the flag is on in production before shipping an image-heavy first-touch surface). No
known jank notes in code.

---

## Area 3 — Anon vote budget

- **Server-authoritative.** `anon_vote_budget` table (composite PK
  `fdx_sid + surface_type + target_id`), identity via httpOnly `fdx_sid` cookie minted by
  `anonIdentityMiddleware`. Limit: `ANON_VOTE_BUDGET` env, default 8. Secondary IP cap
  (default 40/day). Re-votes on the same target are free (`onConflictDoNothing`); budget
  counts *distinct targets* across five surfaces: `matchup_poll`, `trending_poll`,
  `opinion_poll`, `induction`, `celebrity_person`.
- **Client display:** `useAnonBudget()` already returns
  `{ used, limit, remaining, exhausted, isAnonymous }` from `GET /api/anon-budget`, kept
  in sync post-vote via `applyBudgetFromVoteResponse`. A "3/8" wheel indicator and a
  "2 left" nudge at vote 6 are directly buildable — no new plumbing.
- **`SignupReasonModal`:** LoginPage-local, keyed off `?reason=vote_limit_reached`. Not
  designed to render inside an arbitrary overlay (though it portals to body). The
  existing flow navigates to `/login` and restores UI via the auth-return snapshot.
- **Coverage gaps for the wheel (important):**
  - **Curate profile-image voting is `requireAuth`** — not a budget surface; anon users
    cannot vote at all.
  - **Overrated/Underrated is client-blocked for anon** (sign-in toast in
    `UnderratedOverratedCard`) even though the server shares the `celebrity_person`
    budget surface. Enabling it is a small client change (wire `checkVoteGate`).
  - Approval-rating and value-vote on the *same person* share one budget unit.
- On signup, `/api/profile/sync` migrates anon votes to the new account and clears the
  `fdx_sid` budget rows — so the "spend 8, then sign up" streak carries the user's votes
  with them. This validates the streak-to-signup design.

---

## Area 4 — Signup → return flow

Largely already built (`client/src/lib/authReturn.ts`):

- `navigateToLogin(setLocation, { mode, reason, voteUi, resumeAction })` stashes a
  sessionStorage snapshot (`voxdex_auth_return_snapshot`, 1 h TTL) with `returnPath`,
  optional `VoteResumePayload` (which **already includes** `snapScrollOpen`,
  `snapScrollSection`, `snapScrollInitialId`, `savedWindowScrollY`), and an optional
  `resumeAction` (surface + target + pending vote).
- Onboarding: `/login` → optional `/login/verify` (OTP) → `/login/welcome`
  (`WelcomePage`, 6 steps, enforced by `NewUserGate`) → `CompletionStep.finish()` calls
  `redirectAfterLogin`, which navigates to the stashed path and writes
  `AUTH_APPLY_VOTE_UI_ONCE_KEY`; `VotePage` consumes it once and reopens overlays/snap.
- Google OAuth returns to `/login` with the snapshot intact (intent-flag pattern guards
  against stale snapshots).

**Extension needed for the wheel:** add wheel fields to `VoteResumePayload` (or a
parallel payload) — e.g. `quickVoteOpen`, `mixPosition`/`cardId` — and a consume-once
hook wherever the wheel is hosted. If the wheel is hosted outside `/vote`, the
`target.startsWith("/vote")` guard in `redirectAfterLogin` needs a sibling branch. This
is small, well-trodden work; the resumeAction "re-prime the attempted vote" half is
documented in-code as an incomplete Phase 4a — worth finishing as part of this feature.

---

## Area 5 — Nudge infrastructure

- The matchup neutral nudge is **already merged to `main`** (branch
  `feat/matchup-neutral-nudge` is fully merged; files:
  `client/src/lib/matchup-neutral-nudge.ts`, `client/src/hooks/useMatchupNeutralNudge.ts`,
  wired in `VersusCard`).
- **Reusable kernel:** shared module-level IntersectionObserver, 600 ms dwell gate
  before consuming budget (scroll-past doesn't burn it), lifetime cap (9) in
  localStorage + session caps in sessionStorage, module-level morph lock enforcing
  one-nudge-at-a-time, in-memory cache over storage, `prefers-reduced-motion` respect.
- **Not generic:** key names, eligibility semantics, and UI are matchup-specific; there
  is no registry, no cross-nudge arbitration, no global cooldown across nudge families,
  no dismissal analytics. Extraction to a central nudge manager is a **medium** effort —
  the hard patterns (budget, dwell, lock) are proven; the missing parts are structural.
- **Other interrupt surfaces that must be arbitrated with any new nudge:**
  `WelcomeModal` (Home, `voxdex_seen_intro`), `HowItWorksWelcomeModal`,
  `OnboardingDrawer` + first-visit toasts (Vote/Predict/Top Predictors),
  `ReferralPromptGate`, `InterestsGate`, `NewUserGate`, site banners, `useScrollHint`.
  No coach-mark library is in use. Today these fire independently on their own
  localStorage flags — the proposed "one nudge at a time, global cooldown" arbiter has
  to absorb or outrank them, and the entry-nudge design must decide what happens to
  `WelcomeModal` specifically (it occupies the exact first-visit slot the wheel nudge
  wants).

---

## Area 6 — First-visit detection & analytics

- **First-visit detection:** no dedicated flag. Closest proxies: absence of
  `voxdex_seen_intro` / `authoridex_vote_welcome_seen` / `authoridex-has-ever-voted`
  localStorage keys; `onboardingCompletedAt == null` for authed users; server-side
  `fdx_sid` age. A purpose-built `voxdex_first_seen_at` key is trivial to add.
- **Analytics:** GA4 via `client/src/lib/analytics.ts` emits **page views only**. Server
  has a `page_views` table (path, referrer, UA, `fdx_sid` session, country) and an
  `insights_events` table + `POST /api/insights/event` (used only for Insights UI
  telemetry). `share_clicks` handles share/UTM attribution; referral codes attribute
  signups. **Nothing measures:** bounce, overlay opens (snap open/close is pure React
  state), votes per session, nudge impressions/dismissals, or view→signup funnels.
- **Recommendation:** before or alongside Phase 1, add a thin client event helper +
  event table (the `insights_events` pattern generalizes: `event_type`, `surface`,
  `fdx_sid`/`user_id`, metadata JSON). Minimum event set: overlay_open (with source),
  overlay_close (with card index reached), vote_cast (surface + nth-in-session),
  nudge_impression/dismiss/accept, signup_started/completed (with reason + origin).
  Bounce can then be approximated from `page_views` + `fdx_sid` sessions in SQL.

---

## Area 7 — Card curation feasibility

- **Per-type curation exists:** `featured` + `display_order` on `trending_polls`,
  `face_offs`/matchups, `opinion_polls`, managed via the admin Voting CMS
  (drag-reorder writes `display_order`). But `featured` is sparse (8 matchups, 1
  sentiment, 1 opinion) and is **not used** in vote-hub list ordering (only prediction
  markets use featured ordering). Induction/Value/Curate have no featured/pin fields.
- **No cross-category mixed feed endpoint exists.** Closest relatives (recent-activity
  insights, `RelatedVoteItems`, `/api/me/votes`) are not usable as a starter mix.
- **Inventory is ample** (live counts at investigation time: 138 matchups, 90 sentiment,
  76 opinion, 216 induction candidates, 375 value/curate-eligible people). Supply is not
  the gap; cross-type ordering + one feed API is.
- **Smallest additions, two options:**
  1. **No-migration v1:** a `GET /api/vote/starter-mix` endpoint (or even client-side
     composition) that picks top-N per type from existing endpoints using
     `display_order`/`featured`/vote counts, interleaved by a fixed recipe (e.g.
     matchup, sentiment, opinion, matchup, induction, ...). Zero schema change; admin
     controls it indirectly via existing reorder UI.
  2. **Explicit curation:** `starter_mix_items (item_type, item_id, sort_order,
     is_active)` + one read endpoint + (optionally) a Voting CMS tab. Migration via
     Supabase SQL Editor per house rules. This is the durable answer if the mix needs
     hand-picking.

  Recommend starting with (1) and adding (2) only if the heuristic mix underperforms —
  it also avoids a migration before the concept is validated.

---

## Ranked risk list

1. **Vote-state mirroring for Matchup / Induction / Value cards.** Page-local state
   means an overlay outside `VotePage` silently fails the "live mirror" requirement.
   The Value card's cache-key mismatch is a latent cross-instance inconsistency *today*.
   Mitigation: lift to query-cache-first hooks (detail pages already model the pattern).
2. **No measurement.** The feature's goal (bounce reduction) and every tuning decision
   (trigger timing, auto-advance, category order) are currently unmeasurable.
   Mitigation: thin funnel-event layer first.
3. **First-visit interrupt collision.** WelcomeModal, onboarding toasts, referral and
   interests gates all compete for the same session. Without arbitration the new nudge
   *increases* interrupt load. Mitigation: central nudge/interrupt arbiter, and an
   explicit decision on WelcomeModal's fate.
4. **Anon-votability gaps.** Curate (server `requireAuth`) and Value (client gate) can't
   participate in an anon wheel as-is; a 6-category wheel where 2 categories eject anon
   users to login is a UX trap. Mitigation: 4-category anon mix, or scope changes to
   those surfaces.
5. **Mobile-only snap foundation.** Desktop first-visitors need either a desktop wheel
   variant (new layout work) or a different Phase 1 treatment on desktop.
6. **Two card types not extracted** (`DiscourseCard`, `InductionCandidateCard` live
   inside a ~200 KB `VotePage.tsx`). Extraction is mechanical but touches the most
   traffic-critical page; needs careful regression checks.
7. **Signup prompt inside overlay.** `SignupReasonModal` is LoginPage-bound; in-wheel
   budget-exhaustion UX either reuses the navigate-away+restore flow (proven, slightly
   jarring) or extracts the modal (rework). The auth-return snapshot makes the first
   option acceptable for v1.
8. **Image pipeline on first touch.** Confirm `VITE_SUPABASE_IMAGE_TRANSFORM` is enabled
   in production; a first-visit surface built from raw storage URLs would be the wrong
   place to discover it isn't.

---

## Open questions requiring product decisions

1. **Where do new visitors actually land, and which page hosts the entry nudge + wheel?**
   (Home? Vote? Both?) This determines the mounting architecture and whether the
   WelcomeModal is replaced.
2. **Mobile-only v1, or must desktop ship simultaneously?** (No device-split bounce data
   exists to decide this empirically yet — see risk 2.)
3. **Wheel axes for v1:** single curated vertical mix (recommended), or horizontal
   section-switching as originally envisioned?
4. **Category set for anon users:** 4 categories, or invest in enabling Value
   (small client change) and/or rethinking Curate's auth requirement?
5. **What happens to `WelcomeModal` / existing first-visit toasts** when the nudge
   system ships — retire, absorb into the nudge registry, or keep for authed users only?
6. **Auto-advance in the wheel:** confirm the "result reveal, ~1 s hold,
   gesture-cancels-advance" behavior (nothing existing constrains this — snap view has
   no auto-advance, so it's a free design choice).
7. **Starter mix governance:** heuristic recipe (no migration) vs admin-curated table +
   CMS tab from day one?
8. **Analytics scope:** is a minimal funnel-event layer (one table, one endpoint, one
   client helper) in scope as a Phase 0/1 prerequisite?

---

## Suggested phasing (validated against findings — not an implementation plan)

- **Phase 0 (prerequisite):** funnel-event layer + first-visit flag + fix the Value-card
  cache mirror bug (worthwhile independently).
- **Phase 1:** entry nudge (pill, dwell/scroll-triggered, arbitrated against existing
  interrupts) that opens the existing mobile snap view — or a minimal single-column
  Quick Vote variant — on a heuristic starter mix; "3/8" budget indicator via
  `useAnonBudget`; auth-return extension for wheel state.
- **Phase 2:** card-state lifts (matchup/induction/sentiment), desktop treatment,
  admin-curated mix, event-triggered follow-up nudges (comment icon, My Votes, Snap
  view discovery) on the generalized nudge manager.
