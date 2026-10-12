# Architektur

## Überblick

```
Browser / Android-App (Next.js, statisch)  ──►  Cloudflare Worker "pointderecharge-app"
  Karte (MapLibre + OpenFreeMap)                  /api/*: Logik und Rechte (worker/api.ts)
  Seiten für Fahrer/Personal/Admin                D1 (SQLite): Stationen, Status, Reservierungen
                                                  R2: Bilder der Werbung
                                                  Login: Telefonnummer + PIN, Registrierung per SMS-Code (Didit)
```

- Alles läuft bei **Cloudflare**: Der Worker liefert die statische Webapp (`out/`) aus und beantwortet unter `/api/*` alle Datenanfragen. Datenbank ist **D1** (`poinderecharge-db`), Bilder liegen in **R2** (`poinderecharge-media`). Die Mobile App ruft dieselbe API unter `https://app.poinderecharge.com/api` auf.
- **Sicherheit** liegt im Worker: Jede Anfrage prüft die Sitzung (Bearer-Token, in D1 nur als SHA-256 gespeichert) und die Rolle. Jeder darf Stationen und Status lesen, nur zugeordnetes Personal darf den Status seiner Station ändern, nur Admins dürfen Stationen, Rollen und Werbung ändern. Eine Reservierung prüft die freie Menge und legt sie in derselben SQL-Anweisung an, damit zwei Fahrer nicht gleichzeitig den letzten Akku bekommen; ein eindeutiger Index erlaubt nur eine aktive Reservierung pro Fahrer.
- **Login**: Telefonnummer und 4-stellige PIN. Zum Registrieren und bei vergessener PIN bestätigt ein 6-stelliger SMS-Code über Didit die Nummer (5 Minuten gültig), danach legt man die PIN fest; eine neue PIN beendet alle anderen Sitzungen. Zu einfache PINs (0000, 1234 …) werden abgelehnt. Die PIN liegt nur als PBKDF2-Hash in D1; nach 5 falschen PINs ist der Login 15 Minuten gesperrt. Höchstens 5 SMS-Codes pro Nummer und Stunde und 30 pro Stunde insgesamt (`OTP_HOURLY_LIMIT`). Nur +228-Nummern. Sitzungen gelten 60 Tage.
- **Live-Status**: Offene Seiten laden die Daten alle 15 Sekunden neu (nur wenn sichtbar) und sofort nach eigenen Änderungen.

## Datenmodell (Phase 1)

| Tabelle | Inhalt |
|---|---|
| `users` | ein Eintrag pro Nutzer: Telefon, Name, Rolle (`rider`, `operator`, `fleet_manager`, `admin`), PIN-Hash, Fehlversuche, letzter Login |
| `sessions`, `otp_codes` | Logins (nur Hashes gespeichert) |
| `operators` | Betreiber (poinderecharge selbst und fremde) |
| `stations` | Name, Position, Typ (Laden/Tausch/beides), Fahrzeugtypen, Kapazität, Öffnungszeiten |
| `station_status` | live: offen, freie Plätze, volle Akkus, wann und von wem gemeldet |
| `station_staff` | welcher Nutzer welche Station melden darf |
| `reservations` | Akku oder Ladeplatz, gültig 20 Minuten, mit 4-stelligem Abholcode (sieht nur der Fahrer) |
| `charging_points` | einzelne Ladeplätze pro Station (Vorbereitung für vernetzte Steckdosen) |
| `payments` | Flooz/T-Money-Zahlungen pro Reservierung; Preise stehen an der Station (siehe [ZAHLUNGEN.md](ZAHLUNGEN.md)) |
| `promotions` | Werbung für das Fenster beim Öffnen der App |
| `audit_log` | Aktivitätsprotokoll: wer hat wann Status, Reservierungen, Rollen, Personal oder Stationen geändert (nur Admins lesen, siehe [BACKOFFICE.md](BACKOFFICE.md)) |

Verfügbar = gemeldete freie Plätze bzw. volle Akkus minus aktive Reservierungen (`src/lib/availability.ts` und `reserve()` in `worker/api.ts` rechnen gleich). Schema: `worker/migrations/`..

## Zwei Backends

`src/lib/backend/backend.ts` beschreibt, was die App braucht. Es gibt zwei Umsetzungen:

- `DemoBackend`: alles im Browser (localStorage), Beispieldaten, Code `123456`. Standard bei `npm run dev` und wenn `NEXT_PUBLIC_BACKEND=demo` gesetzt ist.
- `CloudflareBackend`: Produktion, ruft die API des Workers auf. Standard bei jedem Build auf Cloudflare.

So kann jeder die App sofort ausprobieren, und die Oberfläche hängt nicht an der Datenbank.

## Später (Phase 2 und 3)

- Bezahlung mit Flooz und T-Money: API und Datenbank sind vorbereitet, die App-Oberfläche fehlt noch (siehe [ZAHLUNGEN.md](ZAHLUNGEN.md))
- greenpoint-Treuepunkte (Regeln, Prämien, Punktebuchungen; siehe Projektplan)
- Vernetzte Steckdosen (LoRa): Geräte melden den Status von `charging_points` selbst
- Flottenbereich für Lieferdienste
- Mobile App (Capacitor), gleiche API
