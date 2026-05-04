# Phase 4 Stage 6 — SignupReasonModal manual test checklist

Run before Stage 7 kickoff. Pre-deploy confidence pass on the pre-signup
context modal across both variants, all three dismissal paths, popstate
sync, accessibility, and mobile responsiveness.

This file is a working scratch — commit separately as `chore(docs)` if
you want it kept, or delete after Stage 6 ships to main. **Do not bundle
it into the Stage 7 commit.**

## Setup

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

## Sign-off

- [ ] All 11 sections passed
- [ ] Any noted issues filed as Phase 4a follow-ups in
      `docs/investigations/anonymous-voting-implementation.md` under
      "Phase 4a follow-ups" rather than blocking Stage 7
