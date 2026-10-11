# Android Play release

GitHub Actions builds a signed Android App Bundle for `com.voxdex.app` and uploads it to Google Play. The workflow is `.github/workflows/android-release.yml`. Local signing on a laptop is still [android/SIGNING.md](../android/SIGNING.md).

The workflow installs npm dependencies, runs `npm run build:mobile`, runs `npx cap sync android`, builds a signed release AAB, uploads that AAB to the chosen Play track, and keeps the AAB as a workflow artifact for 30 days.

Nothing in this pipeline is committed. `android/keystore.properties` is written on the runner and stays gitignored.

## Names to create

GitHub → **Settings → Secrets and variables → Actions**.

### Secrets

| Name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the **existing** Play upload keystore (the same file already used for internal/closed uploads) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore store password (`storePassword` in `keystore.properties`) |
| `ANDROID_KEY_ALIAS` | Key alias (`keyAlias`) |
| `ANDROID_KEY_PASSWORD` | Key password (`keyPassword`) |
| `PLAY_SERVICE_ACCOUNT_JSON` | Entire Google Play service-account JSON key, raw JSON starting with `{` |

### Variable

| Name | Value |
| --- | --- |
| `ANDROID_VERSION_CODE_OFFSET` | The highest `versionCode` already on Play, as a non-negative integer |

Create that row on the **Variables** tab. The same name may be stored as a secret instead. Prefer the variable so Actions does not redact the number in the log.

The workflow input `version_code_offset` overrides the variable and the secret for a single run.

## versionCode

```text
versionCode = ANDROID_VERSION_CODE_OFFSET + github.run_number
```

`github.run_number` counts runs of this workflow and starts at 1. Each new run is at least one higher than the offset, so it is higher than the Play version you copied into the offset.

Example: App bundle explorer shows version code **12**. Set `ANDROID_VERSION_CODE_OFFSET` to `12` before the first run. Run number 1 uploads version code **13**. Run number 4 with that same offset uploads **16**. `github.run_number` counts every run of this workflow, including runs that fail before the upload. The job log prints `offset`, `run_number`, and `versionCode`.

How to read the current code: Play Console → **Test and release** → the internal or closed release, or **App bundle explorer**. Use the integer version code, and use the highest one across every track.

If Play rejects the upload because the version code is still too low, set the offset to the code Play already has and run the workflow again. A re-run reads the updated offset. A brand-new run also works. A re-run of a run that Play already accepted will be rejected as a duplicate version code; start a new run for the next build.

Local `./gradlew` builds do not use this formula. With the env vars unset they stay `versionCode` 1 and `versionName` `1.0`.

## versionName

- **Run workflow** uses `package.json` `"version"` plus the run number. `1.0.0` and run 4 become `1.0.0.4`.
- **Tag** `v1.2.3` (a `v` followed by a digit) uses `1.2.3`. The tag build goes to the **internal** track.

Pushing a `v*` tag such as `v1.2.3` starts this workflow. Use **Run workflow** when you want a different track.

## Tester tracks and production

| Input | Play track | Release status |
| --- | --- | --- |
| `internal` (default) | Internal testing | `completed` (testers can install it) |
| `alpha` | Closed testing, when that track's id is `alpha` | `completed` |
| `closed` | A closed track whose id is `closed` | `completed` |
| `beta` | Open testing (`beta`) | `completed` |
| `production` | Production | `draft` |

Production is uploaded as a draft and is not rolled out. Open the draft in Play Console and send it for review there.

The track id is the last segment of the testing URL in Play Console (`…/tracks/<id>`). Play's first closed-testing track is often `alpha`. If an upload says the track does not exist, run again with the id from that URL. This workflow accepts `internal`, `closed`, `alpha`, `beta`, and `production`.

## Base64 the upload keystore

Use the upload keystore that already signed the builds on Play. Play App Signing rejects a different upload key.

The workflow strips whitespace, then decodes. Paste the base64 text into `ANDROID_KEYSTORE_BASE64`. Do not commit the keystore or the base64.

### Windows PowerShell

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\upload.keystore")) | Set-Clipboard
```

`Set-Clipboard` copies one line. Drop `| Set-Clipboard` to print it instead. `certutil -encode` adds a PEM header; this workflow rejects that header. Use the `Convert` line above.

### macOS

```sh
base64 -i /path/to/upload.keystore | tr -d '\n' | pbcopy
```

`pbcopy` puts the single line on the clipboard.

## Google Play service account

1. Enable **Google Play Android Developer API** for the Cloud project that will own the service account: https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com → **Enable**.
2. In that project, go to **IAM & Admin → Service accounts → Create service account**. Name it something like `github-play-publisher`. Do not grant it any Google Cloud roles.
3. Open the service account → **Keys → Add key → Create new key → JSON**. The browser downloads a JSON file.
4. Open the file, copy the whole document (it starts with `{`), and paste it into the GitHub secret `PLAY_SERVICE_ACCOUNT_JSON`. Delete the downloaded file from the machine when you are done. Do not commit it.
5. Play Console → **Users and permissions** → **Invite new users**. Paste the service account email (`…@….iam.gserviceaccount.com`). A service account does not have to accept the invite.
6. Under **App permissions**, add the VoxDex app (`com.voxdex.app`) and grant:
   - **View app information and download bulk reports**
   - **Release apps to testing tracks**
   - **Release to production, exclude devices, and use Play App Signing** — only if you will use the `production` track

Account-level admin is not required. Invite the account on the Play developer account that owns `com.voxdex.app`.

The API can only upload to an app that already exists on Play. The first AAB was uploaded from a laptop; this workflow publishes the next ones.

## Run the workflow

1. GitHub → **Actions** → **Android release** → **Run workflow**.
2. Branch: `main`, after this workflow is merged. Another branch that already contains this file also works. Either way the run uploads a real build to Play.
3. Track: `internal` unless you mean a different track.
4. Release notes: optional. Empty notes become `VoxDex <versionName>`.
5. Version code offset: leave empty to use the `ANDROID_VERSION_CODE_OFFSET` variable. Fill it only to override that variable for this run.
6. **Run workflow**.

The job log prints `versionName`, `versionCode`, `offset`, `run_number`, `track`, and `status`. The AAB is attached to the run as an artifact named `voxdex-<versionName>-<versionCode>`. Play testers on that track get the build when the upload step succeeds. Internal, closed, alpha, and beta uploads are completed releases. Production stays a draft.

A `v` tag pushed to the repo (`git tag v1.2.3 && git push origin v1.2.3`) runs the same workflow against the internal track with version name `1.2.3`.
