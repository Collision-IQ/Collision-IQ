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
