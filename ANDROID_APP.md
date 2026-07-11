# Android app

This project is ready to be opened as an Android app through Capacitor.

## What is already done

- Capacitor is installed.
- Android project is created in `android/`.
- The app id is `com.katarik.game`.
- The app name is `Katarik`.
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

## Required on this computer

To create the APK locally, install:

- Android Studio
- JDK 17 or newer
- Android SDK through Android Studio

Right now the project cannot build an APK on this computer because Java is not
installed or `JAVA_HOME` is not configured.
