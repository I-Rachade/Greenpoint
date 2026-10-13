# poinderecharge

Adresse: https://app.poinderecharge.com (Landingpage: https://poinderecharge.com) · Repository: `Greenpoint` · Treueprogramm: greenpoint · Kontakt: contact@poinderecharge.com

Webapp für Kunden mit E-Scootern, E-Tricycles, E-Bikes und E-Rollern in Lomé (Togo): Sie zeigt live die nächste Ladestation oder Akkutausch-Station, ob dort Ladeplätze frei oder volle Akkus da sind, und erlaubt Reservierungen. Stationspersonal meldet den Status mit einem Tipp vom Handy.

Die App ist auf Französisch (Standard) und Englisch und lässt sich auf Android als App installieren (PWA).

## Schnellstart

Voraussetzung: [Node.js 22](https://nodejs.org) (LTS).

```bash
npm install
npm run dev
```

Dann http://localhost:3000 öffnen.

Ohne weitere Einrichtung läuft die App im **Demo-Modus**: Beispielstationen in Lomé, gespeichert nur im Browser, Registrierung mit jeder Telefonnummer und dem SMS-Code `123456`, danach Login mit der gewählten PIN. Dabei kann man die Rolle wählen (Kunde, Personal, Admin), um alle Ansichten auszuprobieren. Tipp: Karte in einem Tab, Personal-Ansicht in einem zweiten Tab öffnen; Änderungen erscheinen sofort im anderen Tab.

Für den echten Betrieb mit Datenbank und SMS-Login: siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Befehle

| Befehl | Was er tut |
|---|---|
| `npm run dev` | Entwicklungsserver mit Live-Neuladen |
| `npm run build` | Fertige, statische Webseite nach `out/` bauen |
| `npm test` | Unit-Tests (Vitest) |
| `npm run lint` | Code-Stil prüfen (ESLint) |
| `npm run typecheck` | TypeScript-Typen prüfen |
| `npm run check` | Lint, Typen und Tests zusammen |

## Seiten

| Pfad | Für wen | Inhalt |
|---|---|---|
| `/` | alle | Karte, Liste nach Entfernung, Filter, Stationsdetails, Reservieren |
| `/login` | alle | Login mit Telefonnummer und PIN; Registrierung und neue PIN per SMS-Code |
| `/reservations` | angemeldete Nutzer | eigene Reservierungen mit Restzeit, stornieren |
| `/operator` | Personal, Admin | zwei große Knöpfe: „Statut“ und „Colis“ (ohne Paketmodul direkt der Status) |
| `/operator/statut` | Personal, Admin | Station öffnen/schließen, volle Akkus und freie Plätze melden, Reservierungen abschließen |
| `/operator/colis` | Personal, Admin | Paketschalter: Pakete annehmen, ausgeben, für die Abholung laden (nur Stationen mit Paket-Depot) |
| `/admin` | Admin | Stationen anlegen und bearbeiten |
| `/contact` | alle | Kontaktadresse |

## Projektstruktur

```
src/
  app/                 Seiten (Next.js App Router), Layout, Icons
  components/          Oberfläche (Karte, Listen, Formulare, Provider)
  lib/
    availability.ts    Verfügbarkeit, Filter, Sortierung nach Entfernung
    geo.ts             Entfernungen, Navigation-Link
    phone.ts           Telefonnummern (+228) prüfen
    i18n/              Texte Französisch (fr.ts) und Englisch (en.ts)
    backend/           Datenzugriff: Demo (Browser) und Cloudflare-API (Produktion)
worker/
  index.ts, api.ts     API unter /api/* (Cloudflare Worker)
  auth.ts              Registrierung per SMS-Code, Login mit PIN, Sitzungen
  migrations/          Datenbank-Schema für D1 (SQL), in Reihenfolge
assets/logo/, design/  Logo, Farben und Schriften
docs/                  Architektur und Deployment
```

Mehr zum Aufbau: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Mitarbeiten

- Texte ändern: `src/lib/i18n/fr.ts` und `src/lib/i18n/en.ts`. Jeder Text muss in beiden Dateien stehen (ein Test prüft das).
- Farben: `src/app/globals.css` (Werte aus `design/tokens.css`). Auf Grün `#1DB954` nie weiße Schrift.
- Vor jedem Commit `npm run check` ausführen. GitHub prüft dasselbe automatisch bei jedem Pull Request.
- Änderungen am Datenbank-Schema immer als neue Datei in `worker/migrations/` (nie alte Dateien ändern, die schon ausgeführt wurden), dann `npm run db:migrate`.
- Lokal mit echter API und Datenbank: `npx wrangler d1 migrations apply DB --local`, Testnummern in `.dev.vars` (siehe `docs/DEPLOYMENT.md`), dann `NEXT_PUBLIC_BACKEND=cloudflare npm run dev:worker`.
