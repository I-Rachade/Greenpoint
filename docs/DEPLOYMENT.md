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
5. Domain **pointderecharge.com** verbinden:
   - Am einfachsten: In Cloudflare **Add a domain** > `pointderecharge.com` (Plan Free). Cloudflare zeigt zwei Nameserver; diese beim Anbieter, bei dem die Domain gekauft wurde, als Nameserver eintragen. Das kann einige Stunden dauern.
   - Danach im Pages-Projekt **Custom domains** > `pointderecharge.com` und `www.pointderecharge.com` hinzufügen. Cloudflare legt die DNS-Einträge und das HTTPS-Zertifikat selbst an.

In Supabase unter **Authentication > URL Configuration** als Site URL `https://pointderecharge.com` eintragen.
