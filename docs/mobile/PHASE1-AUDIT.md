# Phase 1 re-audit — Capacitor shell on main

Documentation only. Re-audit of `main` at `52caeccf253ad85bc07bb3fd1752e4e4fa286ab1` (24 Sep 2026), message `feat: add the Capacitor shell tested on the Pixel 9 emulator`. That commit’s parent is `a720694b` (`fix: let the Android WebView read the production API`). No application, Gradle, Capacitor, or dependency changes in this pass.

The previous audit (draft PR #14, `docs/mobile/PHASE1-AUDIT.md` on `cursor/phase1-android-audit-31bb`) concluded the Pixel 9 shell was not in git. That conclusion is out of date. The shell is on `main`.

The live product is still one app for web and Android: Vercel (`https://voxdex.com`) plus Railway (`authoridex-production.up.railway.app`) plus the same Supabase project. Virtual credits only. There is no separate mobile database, user table, or vote store.

This pass read the tree at `52caeccf`. It did not reinstall the APK, re-run `assembleDebug` (this environment has JDK 21 and no Android SDK), or re-test the Pixel 9 emulator. Where the commit message or the owner brief attests a device result, the notes below say so.

## How to read this

- **In git.** Paths and versions below are on `main` at `52caeccf`.
- **Owner-attested.** The brief says `build:client`, `cap:sync`, and `assembleDebug` were validated locally, and that the Pixel 9 shell loads production data, votes, and email sign-in with the service worker off in the native assets. This audit records that. It does not repeat the device run.
- **Dashboard, not a file.** The Supabase redirect allowlist entry `com.voxdex.app://login`, and Site URL `https://voxdex.com`, are not stored in this repo.

## Checklist

### 1. `capacitor.config.ts`

Present at the repo root.

| Field | Value |
| --- | --- |
| `appId` | `com.voxdex.app` |
| `appName` | `VoxDex` |
| `webDir` | `dist/public` (matches `build.outDir` in `vite.config.ts`) |
| `server.androidScheme` | `https` |

`https` makes the Android WebView document origin `https://localhost`. There is no `server.url` (the shell loads the synced `dist/public` assets, not a live-reload host) and no `server.iosScheme`. Capacitor’s iOS default scheme is `capacitor`, so the iOS document origin is `capacitor://localhost`. There is no `CapacitorHttp` block, so `fetch` stays the WebView `fetch`.

### 2. `android/`

The Android project is committed. `MainActivity` is `android/app/src/main/java/com/voxdex/app/MainActivity.java` (`package com.voxdex.app`, extends `com.getcapacitor.BridgeActivity`). Launcher activity is `.MainActivity` with `android:launchMode="singleTask"` and `android:exported="true"`.

Generated output is gitignored and is not in the tree (correct):

- `android/local.properties`
- `android/.idea/` (root `.gitignore`)
- `android/.gradle/`, `android/build/`, `android/app/build/`
- `android/capacitor-cordova-android-plugins/` (`android/.gitignore`)
- `android/app/src/main/assets/public`, `capacitor.config.json`, `capacitor.plugins.json`

`android/settings.gradle` includes `:capacitor-cordova-android-plugins` and applies `capacitor.settings.gradle`. That plugins directory is created by `npx cap sync`. A clean clone cannot run Gradle until `npm run cap:sync` has created it.

`android/gradle/wrapper/gradle-wrapper.jar` is committed (43,764 bytes, valid zip). `android/gradlew` is committed as mode `100644`, so it is not executable. On macOS and Linux, `./gradlew` needs `chmod +x android/gradlew` (or `bash android/gradlew`).

### 3. `ios/`

The iOS project is committed. Capacitor 8 uses Swift Package Manager, not CocoaPods.

| Piece | Where | Value |
| --- | --- | --- |
| Bundle id | `ios/App/App.xcodeproj/project.pbxproj` `PRODUCT_BUNDLE_IDENTIFIER` | `com.voxdex.app` |
| Marketing version | same file, `MARKETING_VERSION` | `1.0` |
| Build number | same file, `CURRENT_PROJECT_VERSION` | `1` |
| Deployment target | same file, `IPHONEOS_DEPLOYMENT_TARGET` | `15.0` |
| URL scheme | `ios/App/App/Info.plist` `CFBundleURLSchemes` | `com.voxdex.app` |
| URL name | same plist, `CFBundleURLName` | `com.voxdex.app` |
| SPM pin | `ios/App/CapApp-SPM/Package.swift` | `capacitor-swift-pm` exact `8.5.2`, plus local `CapacitorApp`, `CapacitorBrowser`, `CapacitorSplashScreen` |
| Scene OAuth handoff | `ios/App/App/SceneDelegate.swift` | `openURLContexts` forwarded to `SceneDelegateProxy` |

`DEVELOPMENT_TEAM` is unset. `ios/debug.xcconfig` only sets `CAPACITOR_DEBUG = true`. There is no `Podfile`. Synced web assets (`ios/App/App/public`) and `DerivedData` are gitignored.

The tested device in the commit message is the Pixel 9 emulator. This tree contains an iOS project with the same app id. This audit did not build it. A clean iOS build needs a Mac, Xcode, and a signing team.

### 4. Capacitor dependencies

`package.json` ranges and the versions locked in `package-lock.json`:

| Package | `package.json` | Locked |
| --- | --- | --- |
| `@capacitor/core` | `^8.5.2` | `8.5.2` |
| `@capacitor/cli` (devDependency) | `^8.5.2` | `8.5.2` |
| `@capacitor/android` | `^8.5.2` | `8.5.2` |
| `@capacitor/ios` | `^8.5.2` | `8.5.2` |
| `@capacitor/app` | `^8.1.1` | `8.1.1` |
| `@capacitor/browser` | `^8.0.4` | `8.0.4` |
| `@capacitor/splash-screen` | `^8.0.2` | `8.0.2` |

`@capacitor/cli@8.5.2` declares `engines.node` `>=22.0.0`. This repo has no `engines` field and no `.nvmrc`.

Native projects register the same three plugins:

- `android/capacitor.settings.gradle` and `android/app/capacitor.build.gradle` — `:capacitor-app`, `:capacitor-browser`, `:capacitor-splash-screen`
- `ios/App/CapApp-SPM/Package.swift` — the same three, plus Capacitor and Cordova from `capacitor-swift-pm` `8.5.2`

`dev` and `start` in `package.json` still use `cross-env`, `--env-file=.env`, and `NODE_ENV`. Those scripts were not rewritten.

### 5. Mobile build and sync scripts

`package.json`:

- `build:client` — `vite build` (Vercel `buildCommand` in `vercel.json`)
- `build:mobile` — `cross-env CAPACITOR_BUILD=1 vite build`
- `cap:sync` — `npm run build:mobile && npx cap sync`

`vite.config.ts` sets `capacitorBuild = process.env.CAPACITOR_BUILD === "1"`. That mode:

- omits `VitePWA`
- defines `import.meta.env.VITE_API_ORIGIN` as `https://voxdex.com`

The website build does not set `CAPACITOR_BUILD`, so it does not define `VITE_API_ORIGIN` and it still runs `VitePWA` (`registerType: "prompt"`, manifest name VoxDex, `theme_color` / `background_color` `#0f172a`).

There is no `cap run` script. The owner-attested Android debug command, after sync, is `assembleDebug` from `android/`.

### 6. Native OAuth and deep link

| Piece | Where |
| --- | --- |
| Redirect constant `com.voxdex.app://login` | `client/src/lib/nativeOAuth.ts` (`NATIVE_OAUTH_REDIRECT`) |
| `appUrlOpen` listener, `exchangeCodeForSession`, then `Browser.close()` | `installNativeOAuthListener()` in the same file, called from `client/src/main.tsx` |
| Google button | `client/src/pages/LoginPage.tsx` |

On the native platform, `signInWithOAuth` uses `redirectTo: com.voxdex.app://login` and `skipBrowserRedirect: true`, then `Browser.open` with the Supabase URL. On the website, `redirectTo` stays `` `${window.location.origin}/login` `` and the browser redirect is unchanged.

Android receives that URL through the intent filter in `AndroidManifest.xml` (`android:scheme="com.voxdex.app"` and `android:host="login"`) on a `singleTask` activity, which is what `@capacitor/app` needs to emit `appUrlOpen`. iOS registers the scheme in `Info.plist` and forwards the open URL from `SceneDelegate.swift`.

The JS listener accepts any `com.voxdex.app://` URL. The Android filter only matches host `login`.

The commit message attests production data, votes, and email sign-in on the emulator. It does not attest a Google round-trip. The allowlist entry itself lives in the Supabase dashboard.

### 7. `AndroidManifest.xml`

`android/app/src/main/AndroidManifest.xml`:

- Application icon `@mipmap/ic_launcher`, round icon `@mipmap/ic_launcher_round`, label `@string/app_name`, theme `@style/AppTheme`, `allowBackup="true"` (stock template).
- One activity, `.MainActivity`, `singleTask`, `exported`, with `MAIN` / `LAUNCHER` and the `com.voxdex.app` / `login` `VIEW` filter above.
- Stock `FileProvider` authority `${applicationId}.fileprovider`, paths in `android/app/src/main/res/xml/file_paths.xml`.
- One permission: `android.permission.INTERNET`.

No `usesCleartextTraffic`, no network-security config, no `autoVerify` http(s) App Link, no camera, location, or SMS permission.

### 8. Android Gradle

| Setting | Value | File |
| --- | --- | --- |
| Android Gradle Plugin | `8.13.0` | `android/build.gradle` (`com.android.tools.build:gradle:8.13.0`) |
| Google Services classpath | `4.4.4` | same file; the plugin is applied in `android/app/build.gradle` only when `google-services.json` exists. That file is not in git, so the plugin is not applied. |
| Gradle wrapper | `8.14.3` | `android/gradle/wrapper/gradle-wrapper.properties` (`gradle-8.14.3-all.zip`) |
| `minSdkVersion` | `24` | `android/variables.gradle` |
| `compileSdkVersion` | `36` | same |
| `targetSdkVersion` | `36` | same |
| `applicationId` / `namespace` | `com.voxdex.app` | `android/app/build.gradle` |
| `versionCode` | `1` | same |
| `versionName` | `1.0` | same |
| Java compatibility | `VERSION_21` | `android/app/capacitor.build.gradle` |
| `androidxActivityVersion` | `1.11.0` | `android/variables.gradle` |
| `androidxAppCompatVersion` | `1.7.1` | same |
| `androidxCoordinatorLayoutVersion` | `1.3.0` | same |
| `androidxCoreVersion` | `1.17.0` | same |
| `androidxFragmentVersion` | `1.8.9` | same |
| `coreSplashScreenVersion` | `1.2.0` | same |
| `androidxWebkitVersion` | `1.14.0` | same |
| `cordovaAndroidVersion` | `14.0.1` | same |
| `junitVersion` | `4.13.2` | same |
| `androidxJunitVersion` | `1.3.0` | same |
| `androidxEspressoCoreVersion` | `3.7.0` | same |

Release `minifyEnabled` is `false`. There is no `signingConfig`, `storeFile`, or store password. Debug builds use the SDK’s local debug keystore, which is not committed.

`styles.xml` references `@color/colorPrimary`, `@color/colorPrimaryDark`, and `@color/colorAccent`. The app module has no `colors.xml`. That matches the Capacitor `8.5.2` Android template. Those three colors are defined on the library, `@capacitor/android@8.5.2` `capacitor/src/main/res/values/colors.xml` (`#3F51B5`, `#303F9F`, `#FF4081`). They are not a missing file.

`android/gradle.properties` sets `android.useAndroidX=true` and `org.gradle.jvmargs=-Xmx1536m`. It does not set `org.gradle.java.home` or an SDK path.

### 9. App id `com.voxdex.app`

The same id is set in all of these:

- `capacitor.config.ts` `appId`
- `android/app/build.gradle` `namespace` and `applicationId`
- `android/app/src/main/java/com/voxdex/app/MainActivity.java` package
- `android/app/src/main/res/values/strings.xml` `package_name` and `custom_url_scheme`
- `AndroidManifest.xml` intent-filter scheme
- `ios` `PRODUCT_BUNDLE_IDENTIFIER`
- `Info.plist` `CFBundleURLName` / `CFBundleURLSchemes`
- `client/src/lib/nativeOAuth.ts` `NATIVE_OAUTH_REDIRECT` (`com.voxdex.app://login`)

### 10. Icons and splash

Source images committed with the shell:

| File | Size | Dimensions |
| --- | --- | --- |
| `resources/icon.png` | 62,883 bytes | 1024×1024 |
| `resources/splash.png` | 186,337 bytes | 2732×2732 |

Generated Android resources are committed: `mipmap-*` launcher PNGs (including foreground and round), `mipmap-anydpi-v26/ic_launcher.xml` (adaptive icon: background `@color/ic_launcher_background`, foreground `@mipmap/ic_launcher_foreground`), and `drawable`, `drawable-port-*`, and `drawable-land-*` splash PNGs. `res/values/ic_launcher_background.xml` is `#FFFFFF`. Launch theme `AppTheme.NoActionBarLaunch` parents `Theme.SplashScreen` and sets `android:background` to `@drawable/splash`.

Generated iOS resources are committed: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (110,522 bytes, 1024×1024 slot in `Contents.json`) and three splash files in `Splash.imageset` (1x / 2x / 3x). Those three files are the same blob (`33ea6c970f2df1db62a624a55e5bbcc4ee07bbdf`, 41,273 bytes each), which is how the asset catalog was generated.

`client/src/main.tsx` calls `SplashScreen.hide()` when `Capacitor.isNativePlatform()` is true.

The stock vector `android/app/src/main/res/drawable/ic_launcher_background.xml` (template teal grid) is still in the tree. The adaptive icon XML points at the mipmap foreground PNGs and the white color, not at that vector.

There is no separate 512×512 Play listing PNG. `resources/icon.png` is the 1024 source.

### 11. Service worker excluded from the native build

Two gates, both in git:

1. `vite.config.ts` adds `VitePWA` only when `CAPACITOR_BUILD` is not `1`. `build:mobile` is the only script that sets that flag. `vercel.json` `buildCommand` is `npm run build:client` (`vite build`), so the website build still emits the PWA manifest and service worker.
2. `client/src/components/PWAUpdatePrompt.tsx` loads `PWAUpdatePromptWeb` (the module that imports `virtual:pwa-register/react`) only when `import.meta.env.VITE_API_ORIGIN` is absent. The Capacitor `define` sets that variable. The website build does not. `PWAUpdatePrompt` is still mounted from `client/src/App.tsx`. Dev-only unregister stays in `client/src/main.tsx` behind `import.meta.env.DEV`.

Synced native assets are gitignored (`android/app/src/main/assets/public`, `ios/App/App/public`), so `sw.js` is not a committed file either way. The owner brief says the native synced assets have no `sw.js` and the website build still emits the PWA. The source gates match that claim. This audit did not re-run the two Vite builds.

### 12. API origin handling

`client/src/lib/nativeOrigin.ts`, installed from `client/src/main.tsx` (the module also calls `installNativeOriginPatch()` on import; a flag stops a second patch).

When `VITE_API_ORIGIN` is set, `fetch` and `EventSource` rewrite root-relative `/api` and `/attached_assets` URLs, and the same paths on `https://localhost`, `http://localhost`, or `capacitor://localhost`, to `https://voxdex.com`. Other origins are left alone. The patched `EventSource` sets `withCredentials: true`. The `fetch` patch keeps the caller’s `credentials` option.

`client/src/lib/queryClient.ts` already sends `credentials: "include"` (lines 164 and 194). The same option is on the other app `fetch` call sites. Website builds leave `VITE_API_ORIGIN` unset, so this patch does not run and `/api` stays relative. `vercel.json` rewrites `/api/(.*)` and `/attached_assets/(.*)` to Railway.

The mobile origin is hardcoded in the Vite `define` for `CAPACITOR_BUILD`. It is not a committed `.env` value, and there is no staging switch.

### 13. Native CORS and cookies

Server half, from `a720694b`, still on this commit.

| Piece | Where |
| --- | --- |
| Origins `https://localhost` and `capacitor://localhost` | `NATIVE_APP_ORIGINS` / `isNativeAppOrigin` in `server/lib/anonIdentity.ts` |
| Credentialed CORS for those origins only: echoed `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, methods, headers `Authorization`, `Content-Type`, `Idempotency-Key`, `Accept`, and `Cross-Origin-Resource-Policy: cross-origin` | `server/index.ts` (middleware immediately after `helmet`, lines 526–551) |
| `SameSite=None; Secure` for those origins; browsers stay `SameSite=Lax` (`Secure` only when `NODE_ENV` is production) | `authCookieFlags` in `server/lib/anonIdentity.ts` |
| Cookie writers using those flags | `ensureFdxSid` in `server/lib/anonIdentity.ts`; page-view and person-detail `fdx_sid` cookies in `server/routes.ts` (the session cookie name there is also `fdx_sid`); `clearCookie` beside the admin session reset in `server/routes.ts` |

The allowlist is an exact string match. Browser requests to `https://voxdex.com` do not send a matching `Origin` and skip the block.

Alignment with the shell:

| WebView origin | Produced by | Allowed by Railway |
| --- | --- | --- |
| `https://localhost` | `server.androidScheme: "https"` | yes |
| `capacitor://localhost` | iOS default scheme ( `iosScheme` unset ) | yes |

`nativeOrigin.ts` also treats `http://localhost` as a WebView origin when rewriting URLs. `NATIVE_APP_ORIGINS` does not include `http://localhost`. The committed Capacitor config does not use `http`, so the live Android origin is the one Railway allows.

Auth session is not that cookie. `client/src/lib/supabase.ts` uses `persistSession: true`, `autoRefreshToken: true`, and `storageKey: 'authoridex-auth'` (localStorage). Email/password survival across process death is that storage key. `fdx_sid` is the anonymous cookie and is the one that needs `SameSite=None` because the document origin and `https://voxdex.com` differ.

### 14. Android back navigation

There is no `backButton` listener in the client. The only `App.addListener` call is `appUrlOpen` in `client/src/lib/nativeOAuth.ts`. `capacitor.config.ts` does not set `plugins.App.disableBackButtonHandler`.

`@capacitor/app@8.1.1` (`AppPlugin.java`) registers an `OnBackPressedCallback` that is enabled by default. With no `backButton` listeners, the callback calls `webView.goBack()` when the WebView can go back, and otherwise returns without finishing the activity. At the root of WebView history the system back gesture is consumed and the app stays open.

In-app back buttons use `client/src/lib/goBack.ts`: `history.back()` when `history.length > 1`, otherwise a route fallback. That pushes and walks WebView history for those screens. Overlays that never push a history entry are not covered by either path.

### 15. Native plugins installed vs still Web APIs

Installed and called:

| Plugin | Locked | Call site |
| --- | --- | --- |
| `@capacitor/core` | `8.5.2` | `Capacitor.isNativePlatform()` in `main.tsx` and `nativeOAuth.ts` |
| `@capacitor/app` | `8.1.1` | `appUrlOpen` only |
| `@capacitor/browser` | `8.0.4` | `Browser.open` / `Browser.close` for Google sign-in |
| `@capacitor/splash-screen` | `8.0.2` | `SplashScreen.hide()` |

Still Web APIs. No matching Capacitor plugin is in `package.json` or the native project files:

| Behaviour | Implementation |
| --- | --- |
| Share | `navigator.share` in `client/src/lib/share.ts`, `client/src/lib/home-leaderboard-share.ts`, `client/src/lib/insights-share.ts`, `client/src/components/share/ShareCardModal.tsx`, `client/src/components/comments/CommentActionDrawer.tsx` |
| Haptics | `navigator.vibrate` in `client/src/lib/haptic.ts` |
| Keyboard / visual viewport | `client/src/hooks/useVisualViewportOffset.ts` returns `0` unless the UA is iOS WebKit. No `@capacitor/keyboard` |
| Status bar / insets | `viewport-fit=cover` in `client/index.html` and existing `env(safe-area-inset-*)` padding. No `@capacitor/status-bar` |
| Network status | no plugin |
| Session storage | Supabase localStorage key `authoridex-auth`. No `@capacitor/preferences` |
| HTTP | WebView `fetch`, rewritten by `nativeOrigin.ts`. `CapacitorHttp` is not enabled |
| Push | `google-services.json` absent, so the Google Services plugin is not applied |

`main.tsx`, `nativeOAuth.ts`, and `LoginPage.tsx` import those Capacitor packages on the website bundle as well. Each native call is behind `Capacitor.isNativePlatform()` or the native branch of the Google button.

## Files that should not have been committed

Scanned the shell commits (`a720694b`, `52caeccf`) and the tree at `52caeccf` for `local.properties`, `sdk.dir`, keystores (`.jks`, `.keystore`), signing passwords, `google-services.json`, `.idea/`, private keys, and `.env` files.

None of those are in git. `android/local.properties` and `android/.idea/` are ignored from the root `.gitignore`. The Gradle files do not contain an SDK path or a store password. The wrapper jar and the icon/splash PNGs are the only new binaries, and they are the shell assets (sizes in section 10).

Two template leftovers are committed and are worth knowing about. They are not secrets.

- `android/.gitignore` still has `*.jks`, `*.keystore`, and `google-services.json` commented out (stock Capacitor template, lines 56–65). The root ignore list does not cover `*.jks`. Nothing matching those names is tracked today. A keystore added under `android/` later would not be ignored.
- `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java` still asserts package name `com.getcapacitor.app`. The app id is `com.voxdex.app`. `assembleDebug` does not run this test. `connectedAndroidTest` would fail it. The unit test beside it (`ExampleUnitTest.java`) only checks `2 + 2`.

## What a clean machine still needs to reproduce the Android debug build

The source that was tested is in git. These are the pieces the repo deliberately does not contain, plus one file-mode gap:

1. **Node.js 22 or newer.** Required by `@capacitor/cli@8.5.2`. Not pinned in the repo.
2. **JDK 21.** Required by `JavaVersion.VERSION_21` in `android/app/capacitor.build.gradle`.
3. **Android SDK Platform 36** (and build-tools), because `compileSdk` / `targetSdk` are 36.
4. **`ANDROID_HOME`, or a local `android/local.properties` with `sdk.dir`.** That file is gitignored. A fresh clone does not have it. Android Studio writes it on first open.
5. **`npm ci`, then `npm run cap:sync`.** Sync builds the web assets with `CAPACITOR_BUILD=1` and generates `android/capacitor-cordova-android-plugins` plus `android/app/src/main/assets/public`. `settings.gradle` includes the plugins directory. Gradle before sync fails because that directory is absent.
6. **Executable bit on `android/gradlew`.** Git mode is `100644`. On macOS and Linux, `chmod +x android/gradlew` or `bash android/gradlew assembleDebug`.
7. **The SDK debug keystore**, created by Android Gradle on the first debug build. It should stay out of git. There is no release signing block, so this tree does not produce a Play upload.

`build:client`, `cap:sync`, and `assembleDebug` are owner-attested on the machine that produced `52caeccf`. They were not re-run here.

iOS on a clean machine additionally needs macOS, Xcode, and a development team (`DEVELOPMENT_TEAM` is empty).

## Risks

- Hardware back at the root of the WebView does nothing (section 14). That is the user-visible gap in the shell that is now in git.
- The keystore ignore lines are commented out (section above). No keystore is committed.
- The instrumented test still expects `com.getcapacitor.app`.
- Setting `VITE_API_ORIGIN` on the Vercel project would define it for `build:client` as well. The website would then rewrite `/api` to that origin and `PWAUpdatePrompt` would skip service-worker registration, while `VitePWA` would still emit the worker. Today only the `CAPACITOR_BUILD` define sets the variable.
- `fdx_sid` is a cross-site cookie (`https://localhost` document, `https://voxdex.com` API) with `SameSite=None; Secure`. Email/password session restore uses localStorage `authoridex-auth`, which is why that session is independent of this cookie.
- `targetSdk` 36 is already set. There is no status-bar or edge-to-edge plugin. Insets are the existing CSS safe-area padding. This audit has no new Pixel screenshot to judge overlap. A back-button change should leave that CSS alone.
- Off-site links still use `<a target="_blank">` inside the WebView (`CelebrityInfoModal`, `MomentumSignals`, legal pages, and others). They are unchanged.
- Google’s custom-scheme return is implemented. A successful Google sign-in still depends on the Supabase allowlist, which is not a file in this repo.

## Smallest Phase 2 change (not implemented)

Add one `backButton` listener next to the existing native startup in `client/src/main.tsx` (the `appUrlOpen` listener already lives in `client/src/lib/nativeOAuth.ts`).

Registering that listener turns off the automatic `webView.goBack()` inside `@capacitor/app@8.1.1`. The listener has to do both jobs:

- when `canGoBack` is true, walk history (`history.back()`, the same idea as `client/src/lib/goBack.ts`)
- when `canGoBack` is false, call `App.exitApp()` so the system back gesture leaves the app from the root screen

No new plugin, no Gradle change, no Capacitor upgrade, no icon or status-bar work in that change. Drawers that never push a history entry can be handled in that same listener later, after one of them is shown to ignore back.

## Do not touch

- One Supabase project, one Railway API, one Vercel site. No mobile-only users, votes, or markets.
- `server/scoring/**` and the score path in `server/jobs/ingest.ts`.
- `server/db.ts` and the transaction pooler (port 6543).
- Agent personas, dispatch, settlement, and scheduler timing.
- Weekly Jackpot parimutuel engine.
- `package.json` `dev` and `start` (`cross-env`, `--env-file=.env`, `NODE_ENV`).
- `SUPABASE_SERVICE_ROLE_KEY` on any client, and `.env` files.
- Website PWA: `VitePWA` `registerType: "prompt"` on the non-Capacitor build, and `PWAUpdatePrompt`.
- Browser cookie flags (`SameSite=Lax`) and the exact native origin set (`https://localhost`, `capacitor://localhost`).
- Supabase `storageKey` `authoridex-auth`.
- `vercel.json` `/api` rewrite, and relative `/api` fetches on the website build.
- Website Google `redirectTo` (`` `${window.location.origin}/login` ``) and Supabase Site URL `https://voxdex.com`.
- `useVisualViewportOffset` iOS gate.
- AGP `8.13.0`, Gradle `8.14.3`, `compileSdk` / `targetSdk` 36, and the Capacitor versions above, unless a later task asks for an upgrade.

## Paste for the product owner

### What now exists

The Android and iOS Capacitor shell is in GitHub on `main` (`52caeccf`, “feat: add the Capacitor shell tested on the Pixel 9 emulator”). App id `com.voxdex.app`. The website and the app are still one VoxDex: same Supabase login, same Railway API, same Vercel site, virtual credits only. The earlier note that the shell was only on a laptop is out of date.

### What is correctly configured

Capacitor `8.5.2` (App `8.1.1`, Browser `8.0.4`, Splash Screen `8.0.2`). The Android app loads bundled files from `dist/public` over `https`, so its origin is `https://localhost`. Gradle is AGP `8.13.0` and wrapper `8.14.3`, Java 21, `minSdk` 24, `targetSdk` 36, `versionCode` 1, `versionName` 1.0, and the only permission is internet. Icons and splash are committed (`resources/icon.png` 1024, `resources/splash.png` 2732, plus the generated Android and iOS sizes).

`build:mobile` and `cap:sync` are in `package.json`. The Vercel site still builds with `build:client` and still emits the PWA and service worker. The mobile Vite build turns that plugin off and points API calls at `https://voxdex.com`. Railway allows `https://localhost` and `capacitor://localhost` with credentialed cookies. Email login stays in localStorage (`authoridex-auth`).

Google sign-in in the app opens the system browser and returns to `com.voxdex.app://login`. The website still returns to `https://voxdex.com/login`. No keystore, `local.properties`, SDK path, or Android Studio `.idea` folder is in git. iOS is in the repo with the same bundle id, version 1.0 (1), and iOS 15 as the minimum. The device the commit names is the Pixel 9 emulator.

### What is missing

A clean computer still needs Node 22 or newer, JDK 21, Android SDK 36, and either `ANDROID_HOME` or a local `android/local.properties` (that file is supposed to stay off git). Then `npm ci`, `npm run cap:sync`, and the debug build. `android/gradlew` was saved without the executable bit, so on Mac or Linux it needs `chmod +x` first. The synced website files and the generated Android plugin folder are created by `cap:sync`; they are not meant to be in git.

Our code does not listen for the Android back gesture. From the first screen, that gesture currently does nothing. Google’s return URL is in the app; the Supabase allowlist entry is still a dashboard setting, not a file here. The commit message confirms email sign-in on the emulator, not a new Google round-trip. There is no Play upload key, no release signing block, and no separate 512 Play listing icon. iOS has no signing team in the Xcode project.

### Risks

Back at the root of the app is swallowed, so a person cannot leave with the gesture until the listener below is added. The Android gitignore still has the keystore lines commented out, which is the stock Capacitor template; nothing secret is committed today, and a keystore dropped into `android/` later would not be ignored. The sample instrumented test still expects package `com.getcapacitor.app`, so that test would fail; the debug APK build does not run it. If `VITE_API_ORIGIN` were ever set on the Vercel website build, the site would start behaving like the app and would skip service-worker registration. Anonymous `fdx_sid` cookies are cross-site; the login session itself is localStorage.

### Smallest Phase 2 change

One back-button listener, in the native startup that already handles the OAuth return (`client/src/main.tsx`). Adding the listener turns off Capacitor’s automatic history walk, so the listener should go back through history when it can, and exit the app when it is already on the first screen. No Gradle change, no Capacitor upgrade, no new plugin, no icon work.
