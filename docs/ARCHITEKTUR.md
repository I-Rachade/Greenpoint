# Architektur

## Überblick

```
Browser / Android-App (Next.js, statisch)  ──►  Cloudflare Worker "pointderecharge-app"
  Karte (MapLibre + OpenFreeMap)                  /api/*: Logik und Rechte (worker/api.ts)
  Seiten für Kunde/Personal/Admin                 D1 (SQLite): Stationen, Status, Reservierungen
                                                  R2: Bilder der Werbung
                                                  Login: Telefonnummer oder E-Mail + PIN, Codes per SMS (Didit) oder E-Mail (Cloudflare)
```

- Alles läuft bei **Cloudflare**: Der Worker liefert die statische Webapp (`out/`) aus und beantwortet unter `/api/*` alle Datenanfragen. Datenbank ist **D1** (`poinderecharge-db`), Bilder liegen in **R2** (`poinderecharge-media`). Die Mobile App ruft dieselbe API unter `https://app.poinderecharge.com/api` auf.
- **Sicherheit** liegt im Worker: Jede Anfrage prüft die Sitzung (Bearer-Token, in D1 nur als SHA-256 gespeichert) und die Rolle. Jeder darf Stationen und Status lesen, nur zugeordnetes Personal und die Konten des Betreibers dürfen den Status einer Station ändern, nur Admins dürfen Stationen, Rollen und Werbung ändern. Eine Reservierung prüft die freie Menge und legt sie in derselben SQL-Anweisung an, damit zwei Kunden nicht gleichzeitig den letzten Akku bekommen; ein eindeutiger Index erlaubt nur eine aktive Reservierung pro Kunde.
- **Login**: Telefonnummer oder E-Mail-Adresse und 4-stellige PIN (ein Feld: mit „@“ ist es eine E-Mail). Zum Registrieren und bei vergessener PIN bestätigt ein 6-stelliger Code die Nummer (SMS über Didit, 5 Minuten gültig) oder die Adresse (E-Mail über Cloudflare Email Service, 10 Minuten gültig), danach legt man die PIN fest. Unter „Mon compte“ lässt sich der jeweils andere Kontakt hinzufügen; das Löschen des Kontos bestätigt ein Code per SMS oder E-Mail, nach Wahl; eine neue PIN beendet alle anderen Sitzungen. Zu einfache PINs (0000, 1234 …) werden abgelehnt. Die PIN liegt nur als PBKDF2-Hash in D1; nach 5 falschen PINs ist der Login 15 Minuten gesperrt. Höchstens 5 Codes pro Nummer oder Adresse und Stunde, insgesamt 30 SMS (`OTP_HOURLY_LIMIT`) und 100 E-Mails (`EMAIL_HOURLY_LIMIT`) pro Stunde. Nur +228-Nummern. Sitzungen gelten 60 Tage.
- **Live-Status**: Offene Seiten laden die Daten alle 15 Sekunden neu (nur wenn sichtbar) und sofort nach eigenen Änderungen.

## Datenmodell (Phase 1)

| Tabelle | Inhalt |
|---|---|
| `users` | ein Eintrag pro Nutzer: Telefon und/oder E-Mail, Name, Rolle (`rider` = Kunde, `operator`, `fleet_manager`, `admin`; der gespeicherte Wert `rider` heißt im Code `customer`, siehe `worker/roles.ts`), PIN-Hash, Fehlversuche, letzter Login |
| `sessions`, `otp_codes` | Logins (nur Hashes gespeichert) |
| `operators` | Betreiber (poinderecharge selbst und fremde) |
| `operator_owners` | Betreiber-Konten: welches Konto welchen Betreiber führt. Ein Betreiber hat eine oder mehrere Stationen an verschiedenen Orten; sein Konto arbeitet an allen davon wie Personal, wählt unter `/exploitant` das Personal aus und pflegt Öffnungszeiten und Telefon. Verknüpft wird im Backoffice (Migration `0014_operator_accounts.sql`) |
| `stations` | Name, Position, Typ (Laden/Tausch/beides), Fahrzeugtypen, Kapazität, Öffnungszeiten |
| `station_status` | live: offen, freie Plätze, volle Akkus, wann und von wem gemeldet |
| `station_staff` | welcher Nutzer welche Station melden darf |
| `reservations` | Akku oder Ladeplatz, gültig 20 Minuten, mit 4-stelligem Abholcode (sieht nur der Kunde) |
| `charging_points` | einzelne Ladeplätze pro Station; bei vernetzten Steckdosen meldet das Gerät den Status |
| `devices`, `device_messages`, `device_commands`, `device_callbacks` | vernetzte Steckdosen (LoRa, Xingke-Cloud), ihre Rohmeldungen, Schaltbefehle und bereits verarbeiteten Callbacks, siehe [steckdosen-lora.md](steckdosen-lora.md) |
| `payments` | Flooz/T-Money-Zahlungen pro Reservierung; Preise stehen an der Station (siehe [ZAHLUNGEN.md](ZAHLUNGEN.md)) |
| `parcel_depots`, `parcel_sizes` | Paket-Depot pro Station und Größen/Preise (S–XL, bis 50 kg), im Backoffice pflegbar |
| `parcels`, `parcel_events` | Pakete von Station A nach B: Absender/Empfänger per Telefon, Inhalt, Maße, Preis, Status (`deposited` → `in_transit` → `arrived` → `picked_up`, nach 7 Tagen `stored` → `released`/`auctioned`), 6-stelliger Abholcode (sieht nur der Empfänger) |
| `parcel_notifications`, `parcel_code_failures` | gesendete E-Mails zu Paketen; Sperre nach 5 falschen Codes pro Station |
| `partners`, `partner_api_keys`, `partner_bookings`, `partner_events` | Partner-API: andere Apps buchen Transporte mit einem Schlüssel (nur SHA-256 gespeichert) und bekommen jede Statusänderung als signierten Webhook, siehe [PARTNER-API.md](PARTNER-API.md) |
| `wallets`, `wallet_transactions`, `wallet_fee_settings`, `app_settings` | Portefeuille (Cashplus Phase 1): Guthaben in FCFA pro Nutzer, Hauptbuch mit zwei Zeilen pro Überweisung (gleiche Nummer, Gebühr nur auf der zahlenden Seite), Gebühren und Limits je Produkt, Modul-Schalter `wallet_enabled` (Standard an; ausgeschaltet können nur Admins es nutzen). Jede Buchung ist ein D1-Batch; die Prüfung `balance_xof >= 0` lässt eine Überziehung samt Batch scheitern, ein Idempotenzschlüssel verhindert doppelte Zahlungen. Plan: `planung/cashplus-plan.md` im Projektordner |
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
- Vernetzte Steckdosen (LoRa): Statusmeldung ist eingebaut ([steckdosen-lora.md](steckdosen-lora.md)); Fernsteuerung und Abrechnung pro Ladevorgang folgen mit der Bezahlung
- Flottenbereich für Lieferdienste
- Mobile App (Capacitor), gleiche API
