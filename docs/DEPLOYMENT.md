# Deployment

Die ganze App läuft bei Cloudflare, im Worker **`pointderecharge-app`**: die Webapp (statische Dateien aus `out/`) und die API unter `/api/*` mit der Datenbank D1 und dem Bild-Speicher R2. Konfiguration: `wrangler.jsonc`.

## 1. Was schon eingerichtet ist

- D1-Datenbank **`poinderecharge-db`** (Region Westeuropa), Schema aus `worker/migrations/` ausgeführt.
- R2-Bucket **`poinderecharge-media`** für die Bilder der Werbung.
- Beide sind in `wrangler.jsonc` mit dem Worker verbunden (`DB` und `MEDIA`).

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
| `DIDIT_API_KEY` | Secret | API-Schlüssel aus der Didit Business Console (verschickt die SMS-Codes für Registrierung und neue PIN) |
| `DIDIT_CHANNEL` | Text, optional | `sms` (Standard) oder `whatsapp`; ist der Kanal für eine Nummer nicht verfügbar, schickt Didit eine SMS |
| `ADMIN_PHONES` | Text | Nummern, die bei der **Registrierung** Admin werden, z. B. `+22890123456` (mehrere mit Komma) |
| `TEST_OTP` | Text, optional | Testnummern mit festem Code ohne SMS, z. B. `+22890000001=123456`. In Produktion leer lassen oder nur für eigene Nummern. |
| `OTP_HOURLY_LIMIT` | Text, optional | höchstens so viele SMS-Codes pro Stunde insgesamt (Standard 30) |

Didit: Konto auf https://business.didit.me anlegen, Guthaben aufladen (Telefon-Verifizierung ist erst nach der ersten Aufladung aktiv), unter der Anwendung den API-Schlüssel kopieren. Kosten: 0,04 $ pro verschickten Code plus Gebühr des Netzes je nach Land und Kanal (https://docs.didit.me/getting-started/phone-verification-pricing); die Prüfung des Codes ist kostenlos. Die App nimmt nur +228-Nummern an, damit keine teuren Codes ins Ausland gehen. Didit lehnt Wegwerf- und Internet-Nummern bei der Registrierung ab. SMS kosten nur bei Registrierung und vergessener PIN; der tägliche Login mit PIN ist kostenlos.

## 4. Rollen vergeben

- Admin: Nummer in `ADMIN_PHONES` eintragen, bevor sie sich registriert. Wer schon angemeldet war: in der Cloudflare-Konsole (**D1 > poinderecharge-db > Console**) `update users set role = 'admin' where phone = '+228…';`.
- Danach vergibt der Admin alle Rollen im Backoffice unter **Utilisateurs**. Personal entsteht, indem man jemanden einer Station zuordnet.

## 5. Datenbank-Änderungen

Neue Datei in `worker/migrations/` anlegen (z. B. `0002_….sql`), nie eine schon ausgeführte ändern. Ausführen mit:

```
npm run db:migrate
```

(braucht ein Cloudflare-Login: `npx wrangler login`). Die Cloudflare-Konsole unter D1 zeigt die Tabellen und erlaubt SQL.

## 6. Lokal entwickeln

- Nur Oberfläche, mit Beispieldaten im Browser: `npm run dev`.
- Mit echter API und lokaler Datenbank:
  1. `npx wrangler d1 migrations apply DB --local`
  2. Datei `.dev.vars` anlegen (wird nicht eingecheckt):
     ```
     TEST_OTP=+22890000001=123456,+22890000002=123456
     ADMIN_PHONES=+22890000001
     ```
  3. `NEXT_PUBLIC_BACKEND=cloudflare npm run dev:worker`, dann http://localhost:8787 öffnen.

## 7. Mobile App

Die Android-App (Capacitor) bringt die Webapp mit und ruft die API im Netz auf. Beim Bauen setzen:

```
NEXT_PUBLIC_BACKEND=cloudflare NEXT_PUBLIC_API_URL=https://app.poinderecharge.com npm run build
```

Der Worker erlaubt Anfragen aus der App (`https://localhost`, `capacitor://localhost`), siehe `worker/http.ts`.
