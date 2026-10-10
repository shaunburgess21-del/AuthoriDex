# Phase 1 — Capacitor Android audit

Read-only audit of `main` at `a720694b` (24 Sep 2026). No application, Gradle, or dependency changes.

The live site is one app for web and Android: Vercel (`https://voxdex.com`) plus Railway (`authoridex-production.up.railway.app`) plus the same Supabase project. Virtual credits only. There is no separate mobile database, user table, or vote store.

The attached brief names later work as phases 2–21 and does not include that catalogue. The order at the end of this file is the smallest safe sequence for that remaining programme.

## How to read this

Two evidence levels:

- **In git.** Paths below are on `main`.
- **Owner-attested, not in git.** Pixel 9 / Android 16 / API 36 checks the owner already signed off. This audit records them. It does not re-test the device, and it cannot verify files that were never committed.

## Owner-attested, not in this repository

The owner confirmed these on a Pixel 9 emulator:

- Capacitor sync, install, and launch succeed.
- The shell loads production data from `https://voxdex.com`.
- Leaderboards, sentiment, matchups, and voting work.
- Email/password sign-in works, and the session is still there after kill and reopen.
- The app uses the same Supabase, Railway, and Vercel backend as the website.
- Credentialed mobile CORS and cookies work. Railway accepts the Capacitor WebView origin.
- The service worker is off in the native build. The website PWA is unchanged.
- `applicationId` is `com.voxdex.app`.
- Google OAuth is expected to return to `com.voxdex.app://login` (already on the Supabase redirect allowlist). Supabase Site URL stays `https://voxdex.com`.

The brief also states Capacitor 8. `package.json` has no `@capacitor/*` dependency, so that version is owner-stated only.

## What already exists

### Server contract for the WebView

Commit `a720694b` (`fix: let the Android WebView read the production API`) is the only Android-specific commit.

| Piece | Where |
| --- | --- |
| Exact origins `https://localhost` (Android) and `capacitor://localhost` (iOS) | `server/lib/anonIdentity.ts` (`NATIVE_APP_ORIGINS`, `isNativeAppOrigin`) |
| Credentialed CORS for those origins only: `ACAO` echoed, `Allow-Credentials: true`, `Vary: Origin`, methods and `Authorization` / `Content-Type` / `Idempotency-Key` / `Accept` | `server/index.ts` (middleware directly after `helmet`) |
| `Cross-Origin-Resource-Policy: cross-origin` on that same branch, so Helmet's default `same-origin` CORP does not hide the body from the WebView | `server/index.ts` |
| `SameSite=None; Secure` cookies for those origins; browsers stay `SameSite=Lax` and `Secure` only in production | `authCookieFlags` in `server/lib/anonIdentity.ts` |
| Cookie writers that use those flags | `ensureFdxSid` in `server/lib/anonIdentity.ts`; page-view middleware and person-detail view cookie in `server/routes.ts`; `clearCookie` beside the admin session reset in `server/routes.ts` |

Browser requests to `https://voxdex.com` send no matching `Origin` and skip this block. The allowlist is an exact string match, so `https://localhost.evil.example` does not qualify.

`/api/*` on the website is rewritten to Railway in `vercel.json`. The client calls relative URLs with cookies:

- `client/src/lib/queryClient.ts` — `fetch(url, { credentials: "include" })` plus `Authorization: Bearer` from the Supabase session
- `client/src/lib/supabase.ts` — `fetch('/api/config/supabase')`, then `createClient` with `persistSession: true`, `autoRefreshToken: true`, `storageKey: 'authoridex-auth'` (localStorage)

That storage key is why email/password can survive process death inside a WebView without a native session plugin.

There is no committed client switch that turns `/api/...` into `https://voxdex.com/api/...` while the document origin stays `https://localhost`. The server half of that cross-origin contract is in git. The shell that produces `Origin: https://localhost` is not. The owner says that pair already works on device, so the missing half is the local project that has not been committed.

### Auth

| Piece | Where |
| --- | --- |
| Email + password, signup, and email-code fallback | `client/src/pages/LoginPage.tsx` |
| Session restore and profile sync | `client/src/contexts/AuthContext.tsx` |
| Google button | `handleGoogleAuth` in `client/src/pages/LoginPage.tsx` |

Google uses `signInWithOAuth` with `redirectTo: ${window.location.origin}/login`. On the website that is `https://voxdex.com/login`, which matches Site URL `https://voxdex.com`. The committed client never sends `com.voxdex.app://login`.

### Web PWA (still the website build)

| Piece | Where |
| --- | --- |
| `vite-plugin-pwa`, `registerType: "prompt"`, manifest name VoxDex, `theme_color` / `background_color` `#0f172a`, portrait, SVG icon | `vite.config.ts` |
| Waiting worker activates only while the tab is hidden | `client/src/components/PWAUpdatePrompt.tsx`, mounted from `client/src/App.tsx` |
| Service-worker unregister | `client/src/main.tsx`, and only when `import.meta.env.DEV` |

No committed `Capacitor.isNativePlatform()` check and no native build script gate the plugin. The owner's "SW off in the native build" flag is outside this tree. `npm run build` / `npm run build:client` still emit the website service worker.

### Mobile web UI the WebView already inherits

These are responsive website behaviors, not Capacitor plugins.

| Piece | Where |
| --- | --- |
| `viewport-fit=cover`, `theme-color` `#0f172a`, SVG favicon and apple-touch icon | `client/index.html` |
| Bottom nav safe-area padding; Android viewport-offset hook returns 0 (iOS WebKit only) | `client/src/components/BottomNav.tsx`, `client/src/hooks/useVisualViewportOffset.ts` |
| Further `env(safe-area-inset-*)` padding | `SiteBanner`, Quick Vote, comment composer/drawer, onboarding, predict detail pages |
| In-app back via `history.back()`, then a route fallback | `client/src/lib/goBack.ts` |
| Haptics through `navigator.vibrate` | `client/src/lib/haptic.ts` (vote, predict, Quick Vote) |
| Share through `navigator.share`, then clipboard, then file download. Attribution stays on the shared URL | `client/src/lib/share.ts`, `client/src/lib/home-leaderboard-share.ts`, `client/src/lib/insights-share.ts`, `client/src/components/share/ShareCardModal.tsx`, `client/src/components/comments/CommentActionDrawer.tsx` |
| Off-site links via `<a target="_blank">` | profiles, market detail, momentum/news cards, login legal links, admin |
| Privacy, terms, contact | `legal/privacy-policy.md` at `/privacy`, `legal/terms-of-service.md` at `/terms`, `client/src/pages/ContactPage.tsx` |

`package.json` scripts stop at web `dev`, `build`, `build:client`, and `start`. There is no `build:mobile`, `cap sync`, or `cap run`. `.gitignore` does not ignore an `android/` directory. The directory is absent because it was never added.

Icons in git are `public/voxdex-logo.svg` and `public/voxdex-favicon.svg`. There is no Play 512 PNG, adaptive-icon XML, or splash drawable.

There is no `assetlinks.json`, no custom-scheme intent filter, and no test covering `isNativeAppOrigin` or `authCookieFlags`.

## What Play polish still needs

Checked against the brief's list. "Missing" means missing from **this repository**. The owner's machine may already have some of it.

| Area | In git today | Still needed before Play polish |
| --- | --- | --- |
| `capacitor.config` | Absent | Commit the working file. Expect `appId` `com.voxdex.app`, Capacitor 8 as the owner stated, `webDir` aligned with `dist/public`. |
| `android/` (manifest, `MainActivity`, themes, Gradle, permissions, `versionCode` / `versionName`) | Absent | Commit the tree that already installs on the Pixel 9. Do not bump AGP, Gradle, or `targetSdk` in that commit. |
| Splash and adaptive icons | SVG logo only | Foreground/background adaptive icon and a splash, generated from the current logo. Play listing icon is a separate 512 PNG. |
| Status bar, edge-to-edge, cutouts | CSS `viewport-fit=cover` and safe-area padding only | Native inset wiring only if a device screenshot shows content under the status bar or gesture bar. API 36 devices enforce edge-to-edge once `targetSdk` is high enough; `targetSdk` is unknown until Gradle is in git. |
| Hardware back | `history.back()` in `goBack.ts` | Keep WebView history. Add a native back listener only for overlays that never push a history entry. |
| Deep links / App Links / `com.voxdex.app://login` | Supabase allowlist only (owner). Client redirects to `${origin}/login` | Native-only OAuth redirect plus an intent filter for that scheme. `https://voxdex.com` App Links need `assetlinks.json` on the website, in their own change. |
| Google Sign-In / Browser plugin | Website OAuth redirect only | No `@capacitor/browser` and no native Google SDK. Custom-scheme return is the smaller path, because the allowlist entry already exists. |
| Auth session | localStorage key `authoridex-auth`; `fdx_sid` cookie flags for native origins | Leave both. Email/password persistence is already attested. |
| CapacitorHttp | `fetch` + `credentials: "include"` | Keep `fetch`. A native HTTP patch would skip the CORS path that just shipped. |
| Service worker | Always registered by the production web build | Keep the website plugin. Commit the native-build switch that already disables it, as a flag the Vercel build does not set. |
| Share | Web Share API | Keep it while the WebView shows the sheet. Add `@capacitor/share` only after a device check shows a no-op. |
| Haptics | Vibration API | Same rule: plugin only if `navigator.vibrate` is a no-op in this WebView. |
| Keyboard | Android path of `useVisualViewportOffset` returns 0 on purpose | `@capacitor/keyboard` only if focused fields sit under the keyboard. |
| Network plugin | Absent | Offline UI is polish, not a launch blocker for a shell that already loads live data. |
| External URLs | `target="_blank"` | Open non-VoxDex `http(s)` links in the system browser (`shouldOpenExternalUrl` or the Browser plugin) so the WebView does not trap them. In-app routes stay on Wouter. |
| Signing, versioning, Data safety | No keystore (correct) and no version file | `versionCode` policy, upload key kept out of git, Play privacy URL `https://voxdex.com/privacy`. The policy text covers `voxdex.com` and does not name `com.voxdex.app`. |
| npm scripts | Web scripts only | Add `cap sync` scripts only when the Android tree lands. Leave `dev` and `start` (`cross-env`, `--env-file=.env`) as they are. |

## Risks to the website if a later phase touches the wrong file

- `vite.config.ts` `VitePWA` and `PWAUpdatePrompt` control every Vercel visitor. `registerType: "prompt"` exists so a deploy does not reload a page mid-scroll. A native SW disable belongs in a separate build mode.
- `authCookieFlags` browser branch is `SameSite=Lax`. Widening `NATIVE_APP_ORIGINS`, using `*`, or flipping all cookies to `SameSite=None` changes session behavior for the website.
- `LoginPage` `redirectTo` is correct for `https://voxdex.com`. A global change to `com.voxdex.app://login` breaks website Google sign-in. Supabase Site URL stays `https://voxdex.com`.
- `storageKey: 'authoridex-auth'` is the live session. Renaming it signs every current user out.
- Relative `/api` URLs plus the `vercel.json` rewrite are the website data path. An unconditional `https://voxdex.com` API host in the shared client breaks local `npm run dev`.
- `useVisualViewportOffset` is intentionally a no-op off iOS. "Fixing" it for Android reopens the bottom-nav gap bugs described in that file.
- `share.ts` attribution query params feed share analytics. A plugin swap has to keep the same URL.
- `server/db.ts`, `server/scoring/`, and `server/jobs/ingest.ts` are unrelated to the shell. So are agent personas, market settlement, and scheduler intervals.

## Recommended order for later phases

Smallest change that has a source of truth, then behavior that is already specified, then store cosmetics. No phase installs a new backend.

1. **Land the shell in git, unchanged.** Commit the local `capacitor.config`, `android/` tree, and the sync script that already runs on the Pixel 9. No package installs, no AGP/Gradle/`targetSdk` bumps, no icon redraw.
2. **Prove the two builds.** Document the native command. Confirm the Vercel build still emits the service worker and the native build still omits it. Bring that switch into git as a flag the web build does not set.
3. **Lock the origin contract.** One sentence in the Capacitor config comments: document origin `https://localhost`, API `https://voxdex.com`, cookies via `authCookieFlags`. Add unit tests for `isNativeAppOrigin` and `authCookieFlags`. No behavior change. Any API-base helper stays behind the native flag so website fetches remain relative.
4. **Google return URL, native only.** When the WebView is the app, `redirectTo` is `com.voxdex.app://login`, with a matching intent filter. Website redirect stays `${origin}/login`.
5. **External links.** System browser for non-VoxDex URLs. Wouter keeps in-app routes.
6. **Hardware back for overlays only**, and only where history is not already pushed.
7. **Insets.** Status bar / cutout / edge-to-edge only after a Pixel screenshot shows overlap. Do not restyle `BottomNav` for the website in that PR.
8. **Splash and adaptive icon** from `public/voxdex-logo.svg`. Leave the PWA manifest icon change for a separate web PR if the SVG must stay.
9. **Share and haptics plugins only where the WebView API no-ops.** Keep `share.ts` and `haptic.ts` call sites and their attribution.
10. **Keyboard plugin only if a focused field is covered.**
11. **App Links** for `https://voxdex.com` plus `assetlinks.json` on Vercel, without editing the `/api` rewrite or OG rewrites in the same patch.
12. **versionCode / versionName and upload signing.** Keystore stays out of git.
13. **Play listing copy.** Privacy URL `https://voxdex.com/privacy`. Data safety: account, votes, predictions, virtual credits, no real-money payments. Legal text that names the Android package is a counsel edit, not an engineering drive-by.
14. **Permission pass** on the committed manifest. `INTERNET` is the expected set. Add nothing speculative (location, SMS, background).
15. **Pre-launch report.** Read `targetSdk` from the committed Gradle. A SDK bump is its own later change, never bundled with icons or OAuth.

Network-status UI and a CapacitorHttp migration are out of this sequence. The live shell already loads production data with `fetch`.

## Do not touch

- Architecture: one Supabase project, one Railway API, one Vercel site. No mobile-only users, votes, or markets.
- `server/scoring/**` and the score path in `server/jobs/ingest.ts`.
- `server/db.ts` and the transaction pooler (port 6543).
- Agent personas, dispatch, settlement, and scheduler timing (`server/agents/**`, market jobs).
- Weekly Jackpot parimutuel engine.
- `package.json` `dev` and `start` (`cross-env`, `--env-file=.env`, `NODE_ENV`).
- `SUPABASE_SERVICE_ROLE_KEY` on any client.
- `.env` files (never commit them).
- Website PWA: `VitePWA` `registerType: "prompt"` and `PWAUpdatePrompt`.
- Browser cookie flags (`SameSite=Lax`) and the exact native origin set (no wildcard).
- Supabase `storageKey` `authoridex-auth`.
- `vercel.json` `/api` rewrite.
- Relative `/api` fetches on the website build.
- Website Google `redirectTo` (`${window.location.origin}/login`) and Supabase Site URL `https://voxdex.com`.
- `useVisualViewportOffset` iOS gate.
- Database table renames or deletes.

## Coordinator note

Paste the PR summary from the pull request body to the product owner. This document is the Phase 1 deliverable.
