# Подписанная Android-сборка

Эта инструкция описывает фактическую release-конфигурацию «Катарика», сборку
подписанных APK/AAB и безопасное восстановление ключа. Она не означает, что
резервная копия уже создана: это отдельно контролируется пунктом `PLAY-03`.

## Текущая конфигурация

| Параметр | Значение |
| --- | --- |
| Application ID | `com.katarik.game` |
| Версия | `versionName 1.0.0`, `versionCode 1` |
| Keystore на рабочем компьютере | `android/katarik-release-key.jks` |
| Локальные параметры подписи | `android/signing.properties` |
| Безопасный шаблон | `android/signing.properties.example` |
| Alias в шаблоне | `katarik` |

`android/app/build.gradle` загружает четыре обязательных значения:
`storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Любая release-задача
останавливается с ошибкой, если файла или значения нет.

Настоящие `.jks`, `.keystore` и `signing.properties` игнорируются правилами
`android/.gitignore`. В Git хранится только шаблон без секретов.

## Ключи Google Play

Для нового приложения Google Play App Signing использует два разных понятия:

- **app signing key** — ключ, которым Google подписывает APK, доставляемые
  пользователям;
- **upload key** — локальный ключ разработчика, которым подписывается AAB перед
  загрузкой в Play Console.

До первой загрузки текущий `katarik-release-key.jks` следует считать критичным
release-ключом. При подключении Play App Signing он может стать upload key.
Решение о ключе подписи приложения принимается в Play Console при первой
публикации.

## Первичная настройка

Если рабочий keystore уже существует, **не создавайте новый поверх него**.
Сначала подтвердите alias и сделайте резервную копию.

Для полностью нового ключа команда запускается из каталога `android`. Пароли
вводятся интерактивно, чтобы они не остались в истории PowerShell:

```powershell
cd android
keytool -genkeypair -v `
  -keystore katarik-release-key.jks `
  -alias katarik `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Создайте локальную конфигурацию из безопасного шаблона:

```powershell
Copy-Item .\signing.properties.example .\signing.properties
```

Заполните локально:

```properties
storeFile=../katarik-release-key.jks
storePassword=СЕКРЕТ
keyAlias=katarik
keyPassword=СЕКРЕТ
```

Не отправляйте содержимое этого файла в чат, issue, логи или CI output.

## Подготовка релиза

Из корня проекта:

```powershell
npm ci
npm ci --prefix client
npm run android:check
npm run cap:sync
```

`npm run android:check` также ожидает `adb` в системном `PATH`. Если Gradle
видит SDK, но проверка сообщает `Android Debug Bridge: missing`, добавьте
Platform Tools для текущего окна PowerShell:

```powershell
$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
adb version
```

Это не мешает Gradle собрать APK/AAB через SDK из `android/local.properties`,
но без доступного `adb` нельзя выполнить установку на телефон из терминала.

Перед каждой публикацией увеличьте `versionCode` в
`android/app/build.gradle`. `versionName` меняется на пользовательскую версию.
Окончательные значения утверждаются в `PLAY-02`.

Проверьте, что Git не отслеживает секреты:

```powershell
git check-ignore -v `
  android/signing.properties `
  android/katarik-release-key.jks

git ls-files `
  android/signing.properties `
  android/katarik-release-key.jks
```

Первая команда должна показать правила `android/.gitignore`, вторая — ничего.

## Сборка APK и AAB

```powershell
cd android
.\gradlew.bat clean assembleRelease bundleRelease
```

Результаты:

```text
android/app/build/outputs/apk/release/app-release.apk
android/app/build/outputs/bundle/release/app-release.aab
```

- APK нужен для локальной установки и проверки.
- AAB загружается в Google Play.

## Проверка подписи

Проверьте APK через Android SDK Build Tools. Команда ниже сама находит
установленный `apksigner.bat`:

```powershell
$apksigner = Get-ChildItem `
  "$env:LOCALAPPDATA\Android\Sdk\build-tools\*\apksigner.bat" |
  Sort-Object FullName -Descending |
  Select-Object -First 1

& $apksigner.FullName verify --verbose --print-certs `
  .\app\build\outputs\apk\release\app-release.apk
```

Проверьте подпись AAB через JDK:

```powershell
jarsigner -verify `
  .\app\build\outputs\bundle\release\app-release.aab
```

Для локального самоподписанного сертификата `jarsigner` может дополнительно
показать предупреждения о self-signed цепочке и отсутствии timestamp. Критичный
результат этой проверки — строка `jar verified` и успешный код завершения.

Сверьте сертификат keystore:

```powershell
keytool -list -v `
  -keystore .\katarik-release-key.jks `
  -alias katarik
```

Сохраните SHA-256 самих артефактов рядом с записью о релизе:

```powershell
Get-FileHash `
  .\app\build\outputs\apk\release\app-release.apk `
  -Algorithm SHA256

Get-FileHash `
  .\app\build\outputs\bundle\release\app-release.aab `
  -Algorithm SHA256
```

APK перед публикацией следует установить на тестовый телефон:

```powershell
adb install -r .\app\build\outputs\apk\release\app-release.apk
```

## Безопасное резервное хранение

Храните отдельно:

1. зашифрованную резервную копию `katarik-release-key.jks`;
2. alias, package id и SHA-256 fingerprint сертификата;
3. пароли keystore/key в менеджере паролей;
4. вторую зашифрованную копию в другом физическом или облачном хранилище с
   включённой двухфакторной аутентификацией.

Не храните keystore и пароли:

- в GitHub, Google Drive или почте без клиентского шифрования;
- в одной папке или одном архиве без отдельной защиты;
- в исходном тексте CI, `.env`, заметках или скриншотах;
- только на рабочем компьютере.

После создания копий проведите проверку восстановления:

1. восстановите keystore во временную защищённую папку;
2. создайте новый локальный `signing.properties`;
3. выполните `keytool -list` и release-сборку;
4. убедитесь, что SHA-256 fingerprint сертификата совпадает с сохранённым и с
   Play Console;
5. удалите временную незашифрованную копию.

## Потеря или компрометация

- До подключения Play App Signing потеря единственного app signing key может
  лишить приложение возможности выпускать совместимые обновления.
- После подключения Play App Signing потерянный или скомпрометированный upload
  key можно заменить через процедуру reset в Play Console.
- При подозрении на утечку прекратите сборки этим ключом, зафиксируйте
  fingerprint и следуйте процедуре Play Console. Не публикуйте сам ключ для
  диагностики.

## Чек-лист одного релиза

- [ ] `versionCode` увеличен, `versionName` проверен.
- [ ] `npm run cap:sync` выполнен с production WebSocket URL.
- [ ] APK и AAB собраны одной зафиксированной Git-версией.
- [ ] APK и AAB подписаны ожидаемым сертификатом.
- [ ] SHA-256 артефактов записаны.
- [ ] Release APK установлен и запущен на телефоне.
- [ ] AAB сохранён как неизменяемый артефакт релиза.
- [ ] Keystore и `signing.properties` отсутствуют в Git.

## Официальные источники

- [Подпись Android-приложений и Play App Signing](https://developer.android.com/studio/publish/app-signing)
- [Подготовка приложения к релизу](https://developer.android.com/studio/publish/preparing)
- [Проверка APK через apksigner](https://developer.android.com/tools/apksigner)
