# Android permissions (Phase 13)

Package `com.voxdex.app`. Capacitor 8. This is the Play-ready inventory for the
merged debug/release manifest. It is locked by `tests/android-permissions.test.ts`.

The app manifest declares one permission. Capacitor plugins merge two more.
`androidx.core` 1.17.0 merges a signature permission the app defines for
itself. Nothing else is merged from `@capacitor/android`, App, Browser,
Filesystem, Share, Splash Screen, `ionfilesystem-android` 1.1.0, or Cordova
framework 14.0.1. Confirmed with `aapt dump permissions` on the debug APK.

## Inventory

| Permission | Source | Feature | Decision |
| --- | --- | --- | --- |
| `android.permission.INTERNET` | App manifest | WebView, API, Google OAuth Custom Tabs, HTTPS | Keep. Normal permission. |
| `android.permission.ACCESS_NETWORK_STATE` | `@capacitor/network` 8.0.1 | Offline banner (`nativeNetworkListener.ts`) | Keep. Normal permission. `ConnectivityManager` requires it. |
| `android.permission.VIBRATE` | `@capacitor/haptics` 8.0.2 | Light impact after a confirmed vote or trade | Keep. Normal permission. No runtime prompt. |
| `com.voxdex.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core:core:1.17.0` (declares the `<permission>` at `protectionLevel="signature"` and the matching `uses-permission`) | AndroidX non-exported dynamic receivers. Not a product feature and not a user grant. | Keep. Stripping it breaks `ContextCompat.registerReceiver` on minSdk 24. Only this app's signature can hold it. |

`INTERNET`, `ACCESS_NETWORK_STATE`, and `VIBRATE` are install-time normal
permissions. The AndroidX entry is signature-level. None of them produce a
runtime permission dialog.

## Reviewed and not declared

| Permission | Why it is absent |
| --- | --- |
| `POST_NOTIFICATIONS` | Push is deferred. In-app notifications are server rows, not OS notifications. Do not add this for a future push phase. |
| `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | No `getUserMedia` and no `<input capture>`. Capacitor's WebChromeClient can request these only after a page asks for capture. They are not in any manifest, so that request cannot succeed. |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | No `navigator.geolocation`. Country on a profile is server-side IP data. |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_*` | `@capacitor/filesystem` can request these for `Directory.Documents` / `Directory.ExternalStorage`, but its manifest does not declare them and the app never calls `requestPermissions`. Share writes `Directory.Cache` only (`cachePngForAndroidShare`). App cache does not need storage permission. `<input type="file">` uses the system picker. |
| Contacts, Bluetooth, SMS, phone, sensors, `AD_ID`, `QUERY_ALL_PACKAGES` | No plugin and no call site. `google-services.json` is not applied, so Firebase / Play services do not merge in. |

`tools:node="remove"` is not used. There is no unused plugin permission to strip.

## Not permissions

- `@capacitor/browser` adds a `<queries>` intent for `CustomTabsService` so Custom Tabs can be resolved on Android 11+. Package visibility, not a permission. OAuth and external links depend on it.
- App Links (`https://voxdex.com` + `autoVerify`) and the OAuth scheme `com.voxdex.app://login` are intent filters. They do not need extra permissions.
- `res/xml/file_paths.xml` grants the non-exported FileProvider only `cache/share`, which is where Share writes PNGs (`ANDROID_SHARE_CACHE_DIR`). Phase 14 removed the Capacitor `<external-path path=".">` root. That change does not add or remove a storage permission. See `android/SECURITY.md`.

## Runtime requests

No JS or app Java/Kotlin calls `requestPermissions`, `checkPermissions`, `getUserMedia`, or `Notification.requestPermission`. Haptics, Network, Share, and Filesystem cache writes do not prompt.
