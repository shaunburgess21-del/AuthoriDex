# Android release signing (Phase 15)

Package `com.voxdex.app`. Release bundles are signed with a local upload keystore. The keystore file and `android/keystore.properties` stay on the machine that runs the release build. Both are gitignored (`*.jks`, `*.keystore`, and `keystore.properties`). This repository does not contain a keystore, store password, key password, or key alias.

`applicationId` stays `com.voxdex.app`. `versionCode` stays `1`. `versionName` stays `1.0`.

## Local setup

1. Create an upload keystore with Android Studio (**Build > Generate Signed App Bundle / APK**, create a new keystore) or with `keytool` (below). Keep the file outside git.
2. From `android/`, copy the example and fill it in on that machine only:

   ```sh
   cp keystore.properties.example keystore.properties
   ```

   The file has four keys: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. `storeFile` is resolved from `android/app/`. A keystore kept next to `keystore.properties` is a path one directory up. An absolute path also works.
3. From `android/`:

   ```sh
   ./gradlew bundleRelease
   ```

   Output: `android/app/build/outputs/bundle/release/app-release.aab`

`./gradlew assembleDebug` does not read `keystore.properties`. A missing file does not fail a debug build. `bundleRelease` needs the real file and keystore.

## Play App Signing

The local keystore is the upload key. Google Play App Signing holds the app signing key. Do not change `public/.well-known/assetlinks.json` here. That file still carries the debug certificate fingerprint.

## keytool

`keytool` prompts for the store password and the key password. Pick the path and alias on the machine that will keep the key. Do not commit either value.

```sh
keytool -genkeypair -v -keystore <path-to-upload-keystore> -keyalg RSA -keysize 2048 -validity 10000 -alias <your-alias>
```
