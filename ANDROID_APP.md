# Android app

This project is ready to be opened as an Android app through Capacitor.

## What is already done

- Capacitor is installed.
- Android project is created in `android/`.
- The app id is `com.katarik.game`.
- The app name is `Katarik`.
- The Android release version is `1.0.0` (`versionCode 1`).
- The mobile build connects to the online server:
  `wss://katarik-5g25.onrender.com`.

## Build commands

From the project root:

```powershell
npm install
npm run android:check
npm run cap:sync
npm run android:open
```

`npm run android:open` opens the project in Android Studio.

`npm run android:check` checks whether Java, Android tools, and the Android
project are available on this computer.

## APK build

After Java and Android Studio are installed, the debug APK can be built with:

```powershell
cd android
.\gradlew.bat assembleDebug
```

The APK will be here:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

## Signed release

The complete release, verification, backup, restore, and incident procedure is
documented in
[`docs/ANDROID_SIGNED_RELEASE.md`](docs/ANDROID_SIGNED_RELEASE.md).

The release key and its passwords must remain only on the developer's
computer. They must never be committed to GitHub.

The local files are:

```text
android\katarik-release-key.jks
android\signing.properties
```

If the settings file needs to be restored, copy
`android\signing.properties.example` to `android\signing.properties` and fill
in the real passwords.

Build the signed APK:

```powershell
cd android
.\gradlew.bat assembleRelease
```

The signed APK will be here:

```text
android\app\build\outputs\apk\release\app-release.apk
```

Build the Android App Bundle for Google Play:

```powershell
cd android
.\gradlew.bat bundleRelease
```

The bundle will be here:

```text
android\app\build\outputs\bundle\release\app-release.aab
```

## Required on this computer

To create the APK locally, install:

- Android Studio
- JDK 17 or newer
- Android SDK through Android Studio

Java, Android Studio and the Android SDK are installed on the current
development computer. If `npm run android:check` reports that ADB is missing,
add the SDK `platform-tools` directory to `PATH` as described in the signed
release guide.
