# Mobile App (Android und iOS)

Die App ist die Webapp in einer nativen Hülle ([Capacitor](https://capacitorjs.com)). Es gibt nur eine Codebasis: `next build` erzeugt den statischen Export in `out/`, `cap sync` kopiert ihn in das Android-Projekt unter `android/` und das iOS-Projekt unter `ios/`.

## Aufbau

| Datei / Ordner | Inhalt |
|---|---|
| `capacitor.config.ts` | App-ID `com.poinderecharge.app`, Name, Startbildschirm |
| `android/` | natives Android-Projekt (wird eingecheckt; die kopierte Webapp darin nicht) |
| `ios/` | natives iOS-Projekt (Xcode, Swift Package Manager; nur iPhone, Texte für die Standortabfrage in `ios/App/App/Info.plist`) |
| `resources/` | Quellbilder für App-Icon und Startbildschirm |
| `src/lib/native.ts` | `isNativeApp()`: läuft der Code in der App oder im Browser? |
| `src/lib/use-position.ts` | Standort: in der App über das native Plugin, im Browser über die Web-API |
| `src/components/native-shell.tsx` | Zurück-Taste (Android) und Links auf app.poinderecharge.com, die die App öffnen |
| `.github/workflows/android.yml` | baut bei jedem PR eine installierbare Test-APK, mit Upload-Schlüssel auch das App Bundle für Google Play |
| `.github/workflows/ios.yml` | baut die iOS-App bei jedem PR auf einem Mac von GitHub (Simulator, ohne Signatur); mit App-Store-Connect-Schlüssel signiert und lädt sie zu TestFlight hoch |

## Lokal bauen

Voraussetzung: Android Studio (bringt Android SDK und Java mit).

```bash
npm ci
npm run android:sync   # next build + cap sync android
npm run android:open   # öffnet das Projekt in Android Studio, dort ▶ Run
```

iOS (nur auf einem Mac mit Xcode):

```bash
npm run ios:sync       # next build + cap sync ios
npm run ios:open       # öffnet das Projekt in Xcode, dort ▶ Run
```

Ohne Mac reicht GitHub: *Actions > iOS* baut die App, mit den Secrets unten landet sie in TestFlight.

Icons und Startbildschirm neu erzeugen, nachdem `resources/` geändert wurde:

```bash
npx @capacitor/assets@3 generate --android --ios --assetPath resources
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

- Upload-Schlüssel (Keystore) als GitHub-Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Dann erzeugt der Workflow zusätzlich das signierte App Bundle und legt es im Release-Entwurf „Google Play Upload“ ab (nur für Mitglieder sichtbar).
- Versionsnummer = Nummer des Workflow-Laufs, so ist jeder Upload eindeutig.
- Store-Screenshots (FR, EN, 1080 × 1920): `scripts/store-screenshots.mjs`, der Workflow *Store screenshots* legt sie im Release `play-store-assets` ab.
- Push-Benachrichtigungen brauchen `android/app/google-services.json` aus Firebase; ohne die Datei baut die App trotzdem, nur ohne Push.

## App Store (iOS)

- Secrets für *Actions > iOS*: `APPLE_TEAM_ID` (Team-ID aus dem Apple-Developer-Konto), `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` und `APP_STORE_CONNECT_KEY_BASE64` (die `.p8`-Datei des API-Schlüssels, base64). Der Schlüssel braucht die Rolle *Admin*, weil Xcode Zertifikat und Provisioning-Profil selbst anlegt (Cloud-Signierung).
- Mit den Secrets signiert jeder Lauf die App und lädt sie zu App Store Connect hoch; sie erscheint nach der Verarbeitung in TestFlight. Build-Nummer = Nummer des Workflow-Laufs, Version `1.0.<Nummer>`.
- Die App muss vorher in App Store Connect angelegt sein (Bundle-ID `com.poinderecharge.app`), sonst schlägt der Upload fehl.
- iPhone-Screenshots (1320 × 2868): `node scripts/store-screenshots.mjs <url> <ordner> fr ios`, der Workflow *Store screenshots* legt sie im Release `app-store-assets` ab.

## Noch offen

- Push-Benachrichtigungen (Firebase, D1-Tabelle für Geräte-Tokens, Versand aus dem Worker)
- App-Links mit Verifizierung (`.well-known/assetlinks.json`, braucht den Signatur-Fingerabdruck aus der Play Console)
- Konto löschen in der App, Seite `/privacy`
- iOS: Push (APNs-Schlüssel, Push-Fähigkeit im Projekt) und Universal Links (`apple-app-site-association`, braucht die Team-ID)
