# Deployment

## 1. Supabase

1. Projekt auf https://supabase.com anlegen (Region Paris oder Frankfurt, Plan Free).
2. Im **SQL Editor** die Dateien aus `supabase/migrations/` der Reihe nach ausführen (nach Dateiname sortiert).
3. Optional `supabase/seed.sql` für Beispielstationen.
4. **Authentication > Sign In / Providers > Phone** aktivieren, Provider Twilio, Account SID, Auth Token und Messaging Service SID eintragen. Für Tests ohne SMS-Kosten unter "Test Phone Numbers and OTPs" Nummern mit festem Code anlegen (z. B. `22890000001=123456`).
5. Unter **Project Settings > API** stehen `Project URL` und `anon public` Key. Beide sind für den Browser gedacht. Den `service_role` Key nie in die App oder ins Repo.

### Rollen vergeben

- Admin: nach dem ersten Login in **Table Editor > profiles** die eigene Zeile auf `role = admin` setzen.
- Personal: Rolle `operator` setzen und in `station_staff` eine Zeile mit `station_id` und `user_id` anlegen.

## 2. Lokal mit Supabase

`.env.example` nach `.env.local` kopieren und die zwei Werte eintragen. `.env.local` wird nicht eingecheckt.

## 3. Cloudflare Pages

1. https://dash.cloudflare.com > **Workers & Pages** > **Create** > **Pages** > **Connect to Git**, GitHub verbinden und das Repo `Greenpoint` wählen.
2. Einstellungen:
   - Production branch: `main`
   - Framework preset: **Next.js (Static HTML Export)**
   - Build command: `npm run build`
   - Build output directory: `out`
3. **Environment variables** (Production und Preview):
   - `NODE_VERSION` = `22`
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public Key
4. "Save and Deploy". Jeder Push auf `main` veröffentlicht automatisch; jeder Pull Request bekommt eine Vorschau-Adresse.
5. Domain: Die Webapp läuft unter **app.poinderecharge.com**, die Landingpage unter **poinderecharge.com**. Die Domain liegt bereits bei Cloudflare. Im Pages-Projekt **Custom domains** > **Set up a custom domain** > `app.poinderecharge.com` > **Activate domain**. Cloudflare legt den DNS-Eintrag und das HTTPS-Zertifikat selbst an.

### Variante: Cloudflare Worker statt Pages

Wurde das Projekt als **Worker** angelegt (Workers & Pages > Create > Import a repository), liest Cloudflare die Datei `wrangler.jsonc` im Repo. Sie baut die App mit `npm run build` und veröffentlicht den Ordner `out` als statische Dateien. Im Dashboard reicht dann:

- Deploy command: `npx wrangler deploy` (Standard)
- **Settings > Build > Branch control**: Production branch ist der Branch mit der App (`claude/project-thread-r72vlu`, später `main`). Der Standard-Branch des Repos enthält die App nicht; baut Cloudflare ihn, meldet wrangler "Could not detect a directory containing static files". "Retry build" baut denselben alten Commit noch einmal, erst ein neuer Push nimmt den umgestellten Branch.
- Die zwei `NEXT_PUBLIC_…`-Werte und `NODE_VERSION` unter **Settings > Build > Variables and secrets** eintragen (Build-Variablen, nicht Laufzeit-Variablen), weil sie beim Bauen in die App geschrieben werden.
- Domain: `wrangler.jsonc` legt `app.poinderecharge.com` beim Deploy als Custom domain an.
- Der Worker-Name im Dashboard muss mit `name` in `wrangler.jsonc` übereinstimmen: `pointderecharge-app`. Der Worker behält diesen Namen, obwohl die App jetzt poinderecharge heißt; ein Umbenennen würde einen neuen Worker erfordern. Der Worker `greenpoint` gehört der Landingpage und bleibt unverändert.

In Supabase unter **Authentication > URL Configuration** als Site URL `https://app.poinderecharge.com` eintragen.
