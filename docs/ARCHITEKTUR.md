# Architektur

## Überblick

```
Browser (Next.js, statisch)  ──►  Supabase
  Karte (MapLibre + OpenFreeMap)     Postgres: Stationen, Status, Reservierungen
  Seiten für Fahrer/Personal/Admin   Auth: Telefonnummer + SMS-Code (Twilio)
                                     Realtime: Status-Änderungen live an alle
```

- Die Webapp ist eine **statische Seite** (`output: "export"`). Es gibt keinen eigenen Server; alle Daten kommen direkt aus Supabase. Das hält die Kosten bei 0 € (Cloudflare Pages + Supabase Free) und macht die spätere Mobile App einfach, weil sie dasselbe Backend nutzt.
- **Sicherheit** liegt in der Datenbank (Row Level Security): Jeder darf Stationen und Status lesen, nur zugeordnetes Personal darf den Status seiner Station ändern, nur Admins dürfen Stationen anlegen. Reservierungen laufen über die Funktion `reserve()`, die prüft, ob noch etwas frei ist, und den letzten Akku gegen gleichzeitige Reservierungen sperrt.
- **Live-Status**: Personal ändert `station_status`; Supabase Realtime schickt die Änderung an alle offenen Apps. Zusätzlich lädt die App alle 30 Sekunden neu, damit abgelaufene Reservierungen wieder frei werden.

## Datenmodell (Phase 1)

| Tabelle | Inhalt |
|---|---|
| `profiles` | ein Eintrag pro Nutzer: Telefon, Name, Rolle (`rider`, `operator`, `fleet_manager`, `admin`) |
| `operators` | Betreiber (Greenpoint selbst und fremde) |
| `stations` | Name, Position, Typ (Laden/Tausch/beides), Fahrzeugtypen, Kapazität, Öffnungszeiten |
| `station_status` | live: offen, freie Plätze, volle Akkus, wann und von wem gemeldet |
| `station_staff` | welcher Nutzer welche Station melden darf |
| `reservations` | Akku oder Ladeplatz, gültig 20 Minuten |
| `charging_points` | einzelne Ladeplätze pro Station (Vorbereitung für vernetzte Steckdosen) |
| `station_holds` (View) | Anzahl aktiver Reservierungen pro Station, ohne zu zeigen, wer reserviert hat |

Verfügbar = gemeldete freie Plätze bzw. volle Akkus minus aktive Reservierungen (`src/lib/availability.ts` und `reserve()` rechnen gleich).

## Zwei Backends

`src/lib/backend/backend.ts` beschreibt, was die App braucht. Es gibt zwei Umsetzungen:

- `DemoBackend`: alles im Browser (localStorage), Beispieldaten, Code `123456`. Wird automatisch genutzt, wenn keine Supabase-Schlüssel gesetzt sind.
- `SupabaseBackend`: Produktion.

So kann jeder die App sofort ausprobieren, und die Oberfläche hängt nicht an der Datenbank.

## Später (Phase 2 und 3)

- Bezahlung mit Flooz und T-Money über einen Zahlungsanbieter (Supabase Edge Function für die Rückmeldung des Anbieters)
- GreenPlus-Treuepunkte (Regeln, Prämien, Punktebuchungen; siehe Projektplan)
- Vernetzte Steckdosen (LoRa): Geräte melden den Status von `charging_points` selbst
- Flottenbereich für Lieferdienste
- Mobile App mit Expo, gleiche Supabase-Datenbank
