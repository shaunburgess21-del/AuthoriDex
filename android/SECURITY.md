# Android security (Phase 14)

Package `com.voxdex.app`. Capacitor 8.5.2 (`@capacitor/android`). Target and compile SDK 36, min SDK 24. This is the Play-minded shell checklist. It is locked by `tests/android-security.test.ts`. Permissions stay in `android/PERMISSIONS.md`.

Inspected the app manifest, FileProvider paths, Gradle build types, `capacitor.config.ts`, `MainActivity`, and Capacitor 8.5.2 `Bridge` / `CapConfig` / `BridgeWebChromeClient`, plus the Share and Filesystem plugins. No auth, score, or market code was changed.

## Findings

| Item | Risk | Action |
| --- | --- | --- |
| Auto Backup (`android:allowBackup="true"`, no rules) | WebView localStorage holds the Supabase session. Auto Backup would copy it to Google Drive. On targetSdk 31+, `allowBackup="false"` alone does not stop device-to-device transfer on every OEM, and a missing `<device-transfer>` block enables that transfer. | **Fix.** `allowBackup="false"`, `backup_rules.xml`, and `data_extraction_rules.xml`. Both cloud backup and device transfer exclude every domain. No `<include>`. No cross-platform transfer. |
| Cleartext and user CAs | targetSdk 36 already blocks cleartext and user-installed CAs, but the shell did not say so. A later manifest merge could reopen HTTP or trust a user CA. | **Fix.** `usesCleartextTraffic="false"` and `network_security_config.xml` (cleartext off, system CAs only). No debug override: `capacitor.config.ts` has no `server.url`. |
| FileProvider `<external-path path=".">` | The Capacitor template root covers all of shared external storage. `@capacitor/share` will grant a read URI for any `file:` path under a configured root. Share writes `cache/share` only. | **Fix.** Drop `external-path`. `<cache-path path="share">` matches `ANDROID_SHARE_CACHE_DIR`. Authority stays `${applicationId}.fileprovider`. |
| WebView JavaScript | The Capacitor bridge needs it. | **Keep.** |
| File URL access (`setAllowFileAccessFromFileURLs`, `setAllowUniversalAccessFromFileURLs`) | Those flags let a `file:` page read other files. Capacitor 8.5.2 never sets them. `allowFileAccess` defaults off when targetSdk is 30+. The shell scheme is `https`. | **Keep.** `MainActivity` does not set them. |
| Mixed content | `android.allowMixedContent` defaults false. The bridge sets `MIXED_CONTENT_ALWAYS_ALLOW` only when that flag is true. | **Keep.** Config does not set it. |
| WebView debugging | `android.webContentsDebuggingEnabled` defaults to the app's `FLAG_DEBUGGABLE`. Debug builds are inspectable. Release is not debuggable unless a build type says so. | **Keep.** Config does not force it on. Release `buildTypes` does not set `debuggable true`. |
| `setJavaScriptCanOpenWindowsAutomatically(true)` and `setGeolocationEnabled(true)` | Capacitor sets both. Window opens are handled by the Phase 9 external-link policy. Geolocation cannot succeed: the manifest has no location permission. | **Keep.** |
| Deep links | `MainActivity` is exported because it is the launcher. OAuth is `com.voxdex.app://login` only. App Links are `https://voxdex.com` with `autoVerify` and the Phase 7 path list, not the whole host. | **Keep.** Filters were not widened or narrowed. |
| Other components | FileProvider is `exported="false"`. `@capacitor/browser`'s `BrowserControllerActivity` is `exported="false"`. The generated Cordova manifest is an empty `<application>`. The merged manifest adds `androidx.startup.InitializationProvider` (`exported="false"`) and `androidx.profileinstaller.ProfileInstallReceiver` (`exported="true"`, permission `android.permission.DUMP`, which is signature-or-privileged). Other apps cannot send those broadcasts. | **Keep.** Do not strip the profile receiver. |
| `android:debuggable` | Not set in source. The debug build type is debuggable. Release is not. | **Keep.** |
| Hardcoded secrets | No API keys, private keys, keystores, or `google-services.json` under `android/`. `*.jks` and `*.keystore` are gitignored. The `google-services.json` gitignore line is commented out. | **Flag only.** Nothing to remove. Do not commit a keystore or an unrestricted `google-services.json`. Leaving that gitignore line commented is a later push-setup choice. |
| ProGuard / R8 | `minifyEnabled false`. `proguard-rules.pro` is the empty Capacitor template. No release crash that needs a keep rule. | **Note only.** Minify stays off. |
| Certificate pinning | Not configured. | **Deferred.** Do not add pinning in this pass. |
| Root detection and obfuscation | Not present. | **Deferred.** Do not add them as product features. |
| Custom-scheme interception | Another app can register `com.voxdex.app`. Content URLs use verified App Links. Moving OAuth off the custom scheme would touch the auth redirect. | **Deferred.** Phase 6 filter stays as it is. |
| HTML `capture` camera | `BridgeWebChromeClient` writes a temp JPEG under `getExternalFilesDir(Pictures)` and needs an `external-files-path` plus `CAMERA`. The app has neither, and no `<input capture>`. A system file picker does not need this provider path. | **Keep unsupported.** Do not add the path or the permission. |
| Play signing / AAB | The App Link fingerprint comment still points at the debug keystore. | **Deferred.** This pass does not sign or build an AAB. |

## What changed

- `android/app/src/main/AndroidManifest.xml` — backup off, extraction rules, cleartext off, network security config.
- `android/app/src/main/res/xml/backup_rules.xml` — new. Pre-Android 12 excludes.
- `android/app/src/main/res/xml/data_extraction_rules.xml` — new. Cloud and device-transfer excludes.
- `android/app/src/main/res/xml/network_security_config.xml` — new.
- `android/app/src/main/res/xml/file_paths.xml` — cache `share` only.
- `client/src/lib/nativeShare.ts` — `ANDROID_SHARE_CACHE_DIR` is the same relative path the provider allows.
- `android/PERMISSIONS.md` — the FileProvider sentence now matches the scoped paths. The permission inventory is unchanged.

OAuth filters, App Link paths, Share's write directory (`Directory.Cache` + `share/`), haptics, offline, and keyboard code were not retargeted.

## Backup domains

Excluded from cloud backup, device transfer, and the pre-Android 12 full-backup file:

`root`, `file`, `database`, `sharedpref`, `external`, `device_root`, `device_file`, `device_database`, `device_sharedpref`.

`root` is the app data directory, which is where the WebView stores localStorage. Cache and `noBackup` directories are already outside Auto Backup. There is no `<cross-platform-transfer>` element; that channel is opt-in on Android 16 and needs an iOS bundle id.
