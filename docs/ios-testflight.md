# iOS TestFlight

First upload of the Capacitor iOS app (`ios/App`, bundle id `com.voxdex.app`). This repo does not contain a Team ID, signing certificate, provisioning profile, or entitlements. Do not invent those values. Android signing is a separate path (`docs/android-release.md`).

Marketing version is **1.0** (`MARKETING_VERSION`), build number is **1** (`CURRENT_PROJECT_VERSION`). `Info.plist` reads both through `CFBundleShortVersionString` and `CFBundleVersion`. Android's local `versionName` is `1.0`.

## When the Apple Developer membership is approved

1. Open [Apple Developer](https://developer.apple.com/account) → Membership details and copy the Team ID. Keep it out of git unless you later decide the Xcode project should pin a team.
2. On a Mac, open `ios/App/App.xcodeproj` in Xcode (Swift Package Manager; there is no CocoaPods workspace).
3. Select the **App** target → **Signing & Capabilities**. Set **Team** to the approved team for **Debug** and **Release**. Leave signing **Automatic**. Confirm the bundle id stays `com.voxdex.app`. Do not add a provisioning profile file, a certificate, Associated Domains, or push.
4. If Xcode does not register the App ID, create it under Certificates, Identifiers & Profiles with bundle id `com.voxdex.app`.
5. App Store Connect → **Apps** → **New App**. Platform iOS. Name **VoxDex**. Bundle ID `com.voxdex.app`. Choose your own SKU (any unique string; this doc does not pick one).
6. Fill the App Privacy questionnaire so it matches `ios/App/App/PrivacyInfo.xcprivacy`, then apply the flags below before you submit.
7. In Xcode, set the run destination to **Any iOS Device**, then **Product → Archive**. In the Organizer, **Distribute App** → **App Store Connect** → **Upload**.
8. After the build finishes processing, TestFlight → **Internal Testing**. Add internal testers (people already on the App Store Connect team). `ITSAppUsesNonExemptEncryption` is false, so the export-compliance prompt should already be answered.
9. The next upload must use a higher build number (`CURRENT_PROJECT_VERSION`). Leave the marketing version at `1.0` until you want a new user-facing version.

Release builds set `CAPACITOR_DEBUG` to false. Debug still uses `ios/debug.xcconfig` (`CAPACITOR_DEBUG = true`). `capacitor.config.ts` has no dev-server URL and no cleartext exception. `Info.plist` has no App Transport Security exceptions.

## Icon and launch screen

- App icon: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`. Generated from `resources/icon.png` (the 1024 brand icon used for Android). Same cube and gradient `#06b6d4` → `#2563eb` as `public/voxdex-logo.svg`, `public/voxdex-favicon.svg`, and `resources/play-icon-512.png`. `resources/icon.png` has transparent rounded corners, which the App Store rejects, so those corners were filled with that gradient and the alpha channel was removed. The file is 1024×1024 RGB.
- Launch screen: `Info.plist` `UILaunchScreen` only. Background color name `LaunchBackground` (`#0F172A` in both light and dark). Image name `LaunchLogo` (the `resources/icon.png` mark, centered by the system, universal and iPad scales). `UILaunchStoryboardName` is not set. If both keys are present, iOS ignores `UILaunchScreen`. `LaunchScreen.storyboard` remains in Copy Bundle Resources, with an initial view controller, only so the Capacitor splash plugin can still open a storyboard named `LaunchScreen`. That plugin does not show it (`launchShowDuration` is 0). iPad support stays (`TARGETED_DEVICE_FAMILY` `1,2`).
- After the launch screen, the WKWebView uses `backgroundColor` and `ios.backgroundColor` `#0F172A`. The mobile web build also paints `html` and `body` that color before CSS, in a layer that loses to the theme token once the stylesheet loads, so light theme is unchanged after first paint.

## Flags to decide before upload

- **iPad.** Kept. `TARGETED_DEVICE_FAMILY` is `1,2`. iPhone orientations are portrait only. iPad still allows portrait, upside down, and both landscapes. App Store Connect will ask for iPad screenshots. The web layout uses wider breakpoints on an iPad-sized window.
- **Privacy manifest data types** (linked to the account, not used for tracking, purpose App Functionality): email address, user ID, other user content (votes, comments, predictions, usernames).
- **Not in the manifest. Confirm on the App Store Connect form:**
  - Photos or Videos. People can attach an image to a poll or a custom contender. Profile photo upload is turned off in Settings (generative avatars only). `uploadAvatarFile` has no caller.
  - Product Interaction and analytics. Google Analytics loads only when `VITE_GA_MEASUREMENT_ID` is set for the web build that goes into the app. Check the build you archive.
  - Name. Usernames are handles and are declared as other user content, not as legal name.
  - Location. Country targeting is a list the person picks. The app does not read device location.
- **UserDefaults.** Not declared. Capacitor 8.5.2 keeps its key-value store in files, and `@capacitor/preferences` is not a dependency. Capacitor's own privacy manifest lists no accessed APIs. If App Store Connect reports `NSPrivacyAccessedAPICategoryUserDefaults`, add reason `CA92.1` (access only from this app).
- **File timestamps.** Declared as `C617.1`. `@capacitor/filesystem` links IONFilesystemLib, which reads file creation and modification dates inside the app container. The app's own share path only writes a cache file and requests its URI.
- **Camera usage string.** Present, because an image file input offers Take Photo and iOS terminates the app if that item is chosen with no `NSCameraUsageDescription`. There is no `NSPhotoLibraryUsageDescription`: on iOS 15 and later the system photo picker does not need one, and there is no camera plugin. There is no microphone string. If Take Photo or Video crashes on a still-image input, add `NSMicrophoneUsageDescription` then.
- **Associated Domains.** Not configured. Android already verifies `https://voxdex.com` App Links. iOS opens the custom scheme `com.voxdex.app` only. Add the entitlement later, with the membership active and `apple-app-site-association` hosted. Do not add it before that.
- **Code sign identity.** The Xcode project still has the Capacitor template value `iPhone Developer` at the project level for Debug and Release. No `DEVELOPMENT_TEAM` is set. Archive signing uses the team you select in Xcode. This repo does not change that identity.
