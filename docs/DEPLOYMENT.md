# Deployment

Die ganze App läuft bei Cloudflare, im Worker **`pointderecharge-app`**: die Webapp (statische Dateien aus `out/`) und die API unter `/api/*` mit der Datenbank D1 und dem Bild-Speicher R2. Konfiguration: `wrangler.jsonc`.

## 1. Was schon eingerichtet ist

- D1-Datenbank **`poinderecharge-db`** (Region Westeuropa), Schema aus `worker/migrations/` ausgeführt.
- R2-Bucket **`poinderecharge-media`** für die Bilder der Werbung.
- Beide sind in `wrangler.jsonc` mit dem Worker verbunden (`DB` und `MEDIA`).
- E-Mail-Versand über **Cloudflare Email Service** (Binding `EMAIL`), Absender `noreply@poinderecharge.com`. Einmalig einzurichten, siehe Abschnitt 3a.

## 2. Build in Cloudflare

Unter **Workers & Pages > pointderecharge-app > Settings > Build**:

- Deploy command: `npx wrangler deploy` (Standard). Der Build (`npm run build`) steht in `wrangler.jsonc`.
- **Branch control**: Production branch ist der Branch mit der App (`claude/project-thread-r72vlu`, später `main`). Der Standard-Branch des Repos enthält die App nicht.
- **Variables and secrets** (Build): `NODE_VERSION` = `22`. Die früheren `NEXT_PUBLIC_SUPABASE_…`-Werte werden nicht mehr gebraucht und können gelöscht werden.
- Jeder Push auf den Production branch veröffentlicht automatisch.
- Domain: `wrangler.jsonc` legt `app.poinderecharge.com` beim Deploy als Custom domain an.
- Der Worker heißt weiter `pointderecharge-app`, obwohl die App jetzt poinderecharge heißt; ein Umbenennen würde einen neuen Worker erfordern. Der Worker `greenpoint` gehört der Landingpage und bleibt unverändert.

## 3. Einstellungen des Workers (Laufzeit)

Unter **Workers & Pages > pointderecharge-app > Settings > Variables and secrets** (nicht unter Build). `wrangler deploy` behält sie (`keep_vars`).

| Name | Typ | Inhalt |
|---|---|---|
| `DIDIT_API_KEY` | Secret | API-Schlüssel aus der Didit Business Console (verschickt die SMS-Codes für Registrierung, neue PIN und Kontolöschung) |
| `DIDIT_CHANNEL` | Text, optional | `sms` (Standard) oder `whatsapp`; ist der Kanal für eine Nummer nicht verfügbar, schickt Didit eine SMS |
| `ADMIN_PHONES` | Text | Nummern, die bei der **Registrierung** Admin werden, z. B. `+22890123456` (mehrere mit Komma) |
| `ADMIN_EMAILS` | Text, optional | E-Mail-Adressen, die bei der **Registrierung** Admin werden, z. B. `chef@poinderecharge.com` (mehrere mit Komma) |
| `DEVICE_WEBHOOK_SECRET` | Secret, optional | Schlüssel der vernetzten Steckdosen, siehe [steckdosen-lora.md](steckdosen-lora.md) |
| `XINGKE_API_HOST`, `XINGKE_API_TOKEN`, `XINGKE_CALLBACK_TOKEN` | Text, Secret, Secret, optional | Xingke-Cloud-API für die Steckdosen, siehe [steckdosen-lora.md](steckdosen-lora.md#xingke-cloud-api) |
| `TEST_OTP` | Text, optional | Testnummern oder -adressen mit festem Code ohne SMS/E-Mail, z. B. `+22890000001=123456,test@poinderecharge.com=123456`. In Produktion leer lassen oder nur für eigene Kontakte. |
| `OTP_HOURLY_LIMIT` | Text, optional | höchstens so viele SMS-Codes pro Stunde insgesamt (Standard 30) |
| `PAYMENT_CALLBACK_SECRET` | Secret | langer Zufallswert für die Rückruf-Adresse des Zahlungsanbieters (siehe [ZAHLUNGEN.md](ZAHLUNGEN.md)) |
| `PAYMENTS_PROVIDER`, `PAYGATE_AUTH_TOKEN` | Text, Secret | erst setzen, wenn das PayGate-Konto freigeschaltet ist; ohne beide läuft die Bezahlung als Simulation |
| `EMAIL_HOURLY_LIMIT` | Text, optional | höchstens so viele Code-E-Mails pro Stunde insgesamt (Standard 100) |
| `FCM_SERVICE_ACCOUNT` | Secret, optional | Push-Benachrichtigungen (Fahrer phase 2): der ganze JSON-Schlüssel eines Firebase-Dienstkontos, siehe Abschnitt 7a. Ohne ihn wird kein Push verschickt, E-Mails gehen weiter. |

Didit: Konto auf https://business.didit.me anlegen, Guthaben aufladen (Telefon-Verifizierung ist erst nach der ersten Aufladung aktiv), unter der Anwendung den API-Schlüssel kopieren. Kosten: 0,04 $ pro verschickten Code plus Gebühr des Netzes je nach Land und Kanal (https://docs.didit.me/getting-started/phone-verification-pricing); die Prüfung des Codes ist kostenlos. Die App nimmt nur +228-Nummern an, damit keine teuren Codes ins Ausland gehen. Didit lehnt Wegwerf- und Internet-Nummern bei der Registrierung ab. SMS kosten nur bei Registrierung und vergessener PIN; der tägliche Login mit PIN ist kostenlos.

## 3a. E-Mail-Versand (Cloudflare Email Service)

Registrierung, Login und Kontolöschung gehen mit Telefonnummer **oder** E-Mail-Adresse. Codes per E-Mail erzeugt der Worker selbst (6 Ziffern, 10 Minuten gültig, nur der Hash wird gespeichert) und verschickt sie über das Binding `EMAIL` in `wrangler.jsonc`. Einmalig im Cloudflare-Dashboard:

1. **Compute > Email Service > Email Sending > Onboard Domain**, Domain `poinderecharge.com` wählen und die vorgeschlagenen DNS-Einträge übernehmen (MX und SPF auf `cf-bounce.poinderecharge.com`, DKIM, DMARC auf `_dmarc.poinderecharge.com`). Cloudflare trägt sie selbst ein, weil die Domain bei Cloudflare liegt.
2. Warten, bis die Domain als verifiziert angezeigt wird (meist 5 bis 15 Minuten).
3. Email Sending braucht den **Workers Paid**-Plan.

Ohne diese Schritte schlägt nur der E-Mail-Versand fehl (Meldung „Une erreur est survenue“); SMS und PIN-Login laufen weiter.

## 4. Rollen vergeben

- Admin: Nummer in `ADMIN_PHONES` (oder Adresse in `ADMIN_EMAILS`) eintragen, bevor sie sich registriert. Wer schon angemeldet war: in der Cloudflare-Konsole (**D1 > poinderecharge-db > Console**) `update users set role = 'admin' where phone = '+228…';` bzw. `where email = '…';`.
- Danach vergibt der Admin alle Rollen im Backoffice unter **Utilisateurs**. Personal entsteht, indem man jemanden einer Station zuordnet.

## 5. Datenbank-Änderungen

Neue Datei in `worker/migrations/` anlegen (z. B. `0002_….sql`), nie eine schon ausgeführte ändern. Ausführen mit:

```
npm run db:migrate
```

(braucht ein Cloudflare-Login: `npx wrangler login`). Die Cloudflare-Konsole unter D1 zeigt die Tabellen und erlaubt SQL.

## 5a. Täglicher Cron (Paket-Depot)

`wrangler.jsonc` hat einen Cron-Trigger `0 8 * * *` (8 Uhr UTC = 8 Uhr in Lomé). Er schickt Abhol-Erinnerungen und legt Pakete nach 7 Tagen ins Entrepôt (`runParcelDeadlines` in `worker/parcels.ts`). Der Trigger wird mit dem nächsten Deploy des Workers aktiv; vorher muss Migration `0005_parcels.sql` ausgeführt sein. Lokal testen: `npx wrangler dev --test-scheduled`, dann `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+8+*+*+*"`.

## 5b. Fahrer (Migration 0007)

Vor dem Deploy des Workers mit der Fahrer-Funktion `npm run db:migrate` ausführen, damit `0007_drivers.sql` läuft. Die Migration legt nur Tabellen und Spalten an und ist auch mit dem alten Worker sicher. Danach im Backoffice unter **Chauffeurs** die eigenen Fahrzeuge mit Kennzeichen anlegen und die Preise prüfen (Start: 500 FCFA + 100 FCFA/km, Express +1 000 FCFA, Fahrer 55 %). Kein neuer Secret, kein neuer Cron: offene Fahrten werden bei jedem Aufruf der Fahrer- und Stationsseiten neu verteilt.

## 5b'. Flottenmanager (Migration 0015)

`npm run db:migrate` legt `fleet_manager_drivers` an (`0015_fleet_managers.sql`, braucht `0007_drivers.sql`). Sicher auch mit dem alten Worker. Danach ordnet der Admin unter **Chauffeurs** Fahrer einem Flottenmanager zu.

## 5b''. OCPP-Ladepunkte (Migration 0023, Durable Object)

`npm run db:migrate` legt `ocpp_transactions` und zwei Spalten in `devices` an (`0023_ocpp.sql`), sicher auch mit dem alten Worker. Der Durable Object `OcppConnection` (Binding `OCPP`, Migration `v1` in `wrangler.jsonc`) wird beim Deploy angelegt; kein neuer Secret. Siehe [steckdosen-lora.md](steckdosen-lora.md#ocpp-16j-direkt-an-unseren-server).

## 5c. Minuten-Cron (Partner-Webhooks)

Der zweite Cron-Trigger `* * * * *` schickt fällige Webhooks an Partner-Apps und wiederholt fehlgeschlagene (`runPartnerEvents` in `worker/partners.ts`). Vorher muss Migration `0008_partner_api.sql` ausgeführt sein. Siehe [PARTNER-API.md](PARTNER-API.md).

## 6. Lokal entwickeln

- Nur Oberfläche, mit Beispieldaten im Browser: `npm run dev`.
- Mit echter API und lokaler Datenbank:
  1. `npx wrangler d1 migrations apply DB --local`
  2. Datei `.dev.vars` anlegen (wird nicht eingecheckt):
     ```
     TEST_OTP=+22890000001=123456,+22890000002=123456,test@example.com=123456
     ADMIN_PHONES=+22890000001
     ```
  3. `NEXT_PUBLIC_BACKEND=cloudflare npm run dev:worker`, dann http://localhost:8787 öffnen.

## 7. Mobile App

Die Android-App (Capacitor) bringt die Webapp mit und ruft die API im Netz auf. Beim Bauen setzen:

```
NEXT_PUBLIC_BACKEND=cloudflare NEXT_PUBLIC_API_URL=https://app.poinderecharge.com npm run build
```

Der Worker erlaubt Anfragen aus der App (`https://localhost`, `capacitor://localhost`), siehe `worker/http.ts`.

## 7a. Push-Benachrichtigungen (Migration 0037)

Fahrer sehen neue Angebote auch bei geschlossener App; Kunden und Händler bekommen dieselben Hinweise wie per E-Mail.

Eingerichtet: Firebase-Projekt `poinderecharge-app` mit der Android-App `com.poinderecharge.app`; `android/app/google-services.json` liegt im Repo und `.github/workflows/android.yml` setzt `NEXT_PUBLIC_PUSH=1`. Offen ist nur noch Schritt 2 (Secret in Cloudflare). iOS-Push ist noch nicht eingerichtet.

1. In der Firebase-Konsole ein Projekt anlegen und eine Android-App mit der Paket-ID aus `capacitor.config.ts` hinzufügen. `google-services.json` herunterladen und nach `android/app/google-services.json` legen.
2. Unter **Projekteinstellungen > Dienstkonten** einen neuen privaten Schlüssel erzeugen und den ganzen JSON-Inhalt als Worker-Secret `FCM_SERVICE_ACCOUNT` speichern.
3. Die App mit `NEXT_PUBLIC_PUSH=1` bauen (zusätzlich zu den Werten oben). Ohne diesen Wert fragt die App nicht nach Push, denn ohne `google-services.json` würde Android beim Registrieren abstürzen.

## Rechtliche Seiten

Mentions légales (`/mentions-legales`), CGU (`/cgu`) und Datenschutzerklärung (`/confidentialite`), Französisch verbindlich, Englisch als Übersetzung. Texte in `src/lib/legal/content.ts`. Angaben, die nur die Firma kennt, stehen dort als `[À COMPLÉTER : …]` / `[TO BE COMPLETED: …]` und sind auf der Seite gelb markiert, bis sie ausgefüllt sind.

Datenschutz-URL für Google Play und App Store: `https://app.poinderecharge.com/confidentialite`. Wer sich registriert, muss vorher CGU und Datenschutzerklärung per Häkchen annehmen.
