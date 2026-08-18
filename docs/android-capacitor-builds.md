# Android Capacitor Builds

Capacitor Android has two supported web loading modes for this project.

## Release / Production

Release APKs load the production site:

```bash
npm run cap:sync:prod
cd android
gradlew.bat assembleRelease
```

With no `CAP_SERVER_URL` set, `capacitor.config.ts` writes:

```text
https://www.collision-iq.ai
```

Local frontend changes will not appear in this APK until they are deployed to production.

## Play Store Bundle (AAB)

Google Play requires an Android App Bundle (`.aab`), not an APK. `assembleRelease`
produces an APK and cannot be uploaded to a Play track.

```bash
npm run android:bundle
```

That runs `cap:sync:prod` (so the WebView points at `https://www.collision-iq.ai`)
and then `gradlew.bat bundleRelease`. On macOS/Linux run the Gradle step directly:

```bash
npm run cap:sync:prod
cd android
./gradlew bundleRelease
```

Output:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

### Signing prerequisites

`bundleRelease` is signed by the release config in `android/app/build.gradle`. All
three of these must be present or the build fails fast with a
`Missing release signing credentials` error naming what is absent:

- `android/collisioniq-release.keystore` — not in the repo; keep it out of git
- `CIQ_RELEASE_STORE_PASSWORD`
- `CIQ_RELEASE_KEY_PASSWORD`

`CIQ_RELEASE_KEY_ALIAS` is optional and defaults to `collisioniq`. Each value is
read from a Gradle property first (e.g. `~/.gradle/gradle.properties`), then from
the environment. An unsigned or debug-signed bundle is rejected by Play.

### Version codes

Play rejects a bundle whose `versionCode` already exists on any track. Bump both
fields in `android/app/build.gradle` before every upload:

```groovy
versionCode 14
versionName "1.0.14"
```

`versionCode` must strictly increase; `versionName` is the human-facing string.

### Uploading to a testing track

1. Play Console → **Test and release** → **Testing** → the target track
   (Internal / Closed / Open testing) → **Create new release**.
2. Upload `app-release.aab`.
3. Add release notes, then **Save** → **Review release** → **Start rollout**.

The Open testing track also requires **Select countries** and **Select testers**
to be complete before a release can roll out; the track's setup checklist shows
which steps are outstanding.

Because `server.url` points the WebView at production, the bundle ships whatever
is currently deployed at `https://www.collision-iq.ai`. Deploy web changes to
production before promoting a build to testers, or testers will not see them.

## Debug / Local Development

Debug APKs can point the Android WebView at a local Next dev server.

For the Android emulator:

```bash
npm run dev
npm run android:debug
```

`android:debug` syncs with:

```text
CAP_SERVER_URL=http://10.0.2.2:3000
```

For a physical Android device, use your machine's LAN IP instead:

```bash
CAP_SERVER_URL=http://<LAN-IP>:3000 npx cap sync android
cd android
gradlew.bat assembleDebug
```

On PowerShell:

```powershell
$env:CAP_SERVER_URL = "http://<LAN-IP>:3000"
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Install the resulting debug APK:

```bash
adb uninstall com.collisionacademy.collisioniq
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Do not test local frontend changes against an APK synced with the production `server.url`. If the APK is configured with `https://www.collision-iq.ai`, it is validating the deployed production site, not the local source tree.
