# Mobile App (Android, später iOS)

Die App ist die Webapp in einer nativen Hülle ([Capacitor](https://capacitorjs.com)). Es gibt nur eine Codebasis: `next build` erzeugt den statischen Export in `out/`, `cap sync` kopiert ihn in das Android-Projekt unter `android/`.

## Aufbau

| Datei / Ordner | Inhalt |
|---|---|
| `capacitor.config.ts` | App-ID `com.poinderecharge.app`, Name, Startbildschirm |
| `android/` | natives Android-Projekt (wird eingecheckt; die kopierte Webapp darin nicht) |
| `resources/` | Quellbilder für App-Icon und Startbildschirm |
| `src/lib/native.ts` | `isNativeApp()`: läuft der Code in der App oder im Browser? |
| `src/lib/use-position.ts` | Standort: in der App über das native Plugin, im Browser über die Web-API |
| `src/components/native-shell.tsx` | Zurück-Taste (Android) und Links auf app.poinderecharge.com, die die App öffnen |
| `.github/workflows/android.yml` | baut bei jedem PR eine installierbare Test-APK, mit Upload-Schlüssel auch das App Bundle für Google Play |

## Lokal bauen

Voraussetzung: Android Studio (bringt Android SDK und Java mit).

```bash
npm ci
npm run android:sync   # next build + cap sync android
npm run android:open   # öffnet das Projekt in Android Studio, dort ▶ Run
```

Icons und Startbildschirm neu erzeugen, nachdem `resources/` geändert wurde:

```bash
npx @capacitor/assets@3 generate --android --assetPath resources
```

## Test-APK aus GitHub

Direkter Link fürs Handy: https://github.com/I-Rachade/Greenpoint/releases/download/android-test/poinderecharge-test.apk (Release `android-test`, wird bei jedem Build ersetzt). Außerdem hängt jeder Lauf von **Actions > Android** `poinderecharge-debug-apk` an. Herunterladen, entpacken, die APK aufs Handy kopieren und öffnen (Installation aus unbekannten Quellen erlauben).

## Backend und Login

Die App spricht mit derselben Worker-API wie die Webapp (`NEXT_PUBLIC_BACKEND=cloudflare`, `NEXT_PUBLIC_API_URL=https://app.poinderecharge.com`, gesetzt im Workflow). In der App ist der Ursprung `https://localhost`; der Worker erlaubt ihn per CORS (`worker/http.ts`), die Sitzung läuft über den Bearer-Token, nicht über Cookies. Anmeldung wie im Web: Registrierung mit SMS-Code, danach Telefonnummer und PIN.

Lokal ohne diese Variablen gebaut (`npm run android:sync`) läuft die App im Demo-Modus. Für einen lokalen Build gegen die echte API:

```bash
NEXT_PUBLIC_BACKEND=cloudflare NEXT_PUBLIC_API_URL=https://app.poinderecharge.com npm run android:sync
```

## Google Play

- Upload-Schlüssel (Keystore) als GitHub-Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Dann erzeugt der Workflow zusätzlich `poinderecharge-release-aab` für die Play Console.
- Versionsnummer = Nummer des Workflow-Laufs, so ist jeder Upload eindeutig.
- Push-Benachrichtigungen brauchen `android/app/google-services.json` aus Firebase; ohne die Datei baut die App trotzdem, nur ohne Push.

## Noch offen

- Push-Benachrichtigungen (Firebase, D1-Tabelle für Geräte-Tokens, Versand aus dem Worker)
- App-Links mit Verifizierung (`.well-known/assetlinks.json`, braucht den Signatur-Fingerabdruck aus der Play Console)
- Konto löschen in der App, Seite `/privacy`
- iOS (`npx cap add ios`, Build über Codemagic), sobald das Apple-Konto da ist
