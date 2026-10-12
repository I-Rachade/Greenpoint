# Backoffice (Admin-Dashboard)

Erreichbar unter `/admin`, nur für Nutzer mit Rolle `admin`. Alle Seiten aktualisieren sich live (bei jeder Status- oder Reservierungsänderung und alle 30 Sekunden).

| Seite | Inhalt |
|---|---|
| **Tableau de bord** `/admin` | Kennzahlen (Stationen, unbestätigte Status, laufende Reservierungen, Reservierungen 7 Tage, Abschluss- und Nichterscheinen-Quote, Nutzer, vernetzte Steckdosen), Reservierungen pro Tag (14 Tage) und die Liste „À vérifier“ mit Auffälligkeiten |
| **Stations** `/admin/stations` | Status aller Stationen inkl. deaktivierter: offen/zu, Zähler gegen Kapazität, gehaltene Reservierungen, wann zuletzt bestätigt, zugeordnetes Personal; Stationen (de)aktivieren; vernetzte Steckdosen mit letztem Signal; darunter der bisherige Stations-Editor |
| **Réservations** `/admin/reservations` | Reservierungen der letzten 30 Tage, filterbar nach Status, Station und Telefon/Name; laufende Reservierungen stornieren |
| **Utilisateurs** `/admin/users` | Alle Nutzer mit Rolle (änderbar, außer der eigenen), zugeordneten Stationen (zuordnen/entfernen), Reservierungen und Nichterscheinen in 30 Tagen, letzter Login |
| **Activité** `/admin/activity` | Aktivitätsprotokoll: wer hat wann was geändert, filterbar nach Bereich, Station und Person |
| **Publicité** `/admin/promotions` | Werbung, die beim Öffnen der App als Fenster erscheint: Titel, Text, Bild, optionaler Button mit Link, aktiv/inaktiv, Zeitraum; mit Vorschau |

## Auffälligkeiten („À vérifier“)

Berechnet in `src/lib/admin/insights.ts` (Tests in `src/lib/__tests__/admin-insights.test.ts`):

| Befund | Regel | Stufe |
|---|---|---|
| Station geschlossen, aber Reservierungen aktiv | geschlossen und mindestens eine haltende Reservierung | Urgent |
| Reservierung hält zu lange | Laufzeit über 21 Minuten (von Hand verlängert) | Urgent |
| Stumme Steckdose | vernetzter Ladepunkt ohne Signal seit 15 Min. oder nie | Urgent |
| Steckdose meldet Fehler | Status `fault` | Urgent |
| Status nicht bestätigt | offene Station, letzte Meldung älter als 2 Std. | À surveiller |
| Zähler über Kapazität | freie Plätze / volle Akkus größer als die Kapazität | À surveiller |
| Viele Reservierungen | ein Fahrer mit 3 oder mehr Reservierungen in 24 Std. (Stornieren und neu Reservieren) | À surveiller |
| Nichterscheinen | ein Fahrer mit 2 oder mehr abgelaufenen Reservierungen in 7 Tagen | À surveiller |
| Eigene Station ohne Personal | keine Zuordnung in `station_staff` | Info |
| Personal ohne Station / Zuordnung ohne Rolle | Rolle und `station_staff` widersprechen sich | Info |
| Abgelaufen, aber noch `active` | Reservierungen, die nie auf `expired` gesetzt wurden | Info |

Die Schwellen stehen als Konstanten oben in `insights.ts`.

## Aktivitätsprotokoll (Audit-Log)

- Tabelle `audit_log` in D1: Zeitpunkt, wer (`actor`, leer = System, z. B. neuer Nutzer beim ersten Login), Tabelle, Aktion, betroffene Station und betroffener Nutzer, und die Änderung (`{Spalte: [alt, neu]}` bzw. die ganze Zeile beim Anlegen/Löschen).
- Der Worker (`worker/api.ts`) schreibt bei jeder Änderung an Nutzern/Rollen, Stationen, Status, Personal, Reservierungen und Werbung einen Eintrag, in derselben Datenbank-Transaktion wie die Änderung.
- Lesen dürfen nur Admins. Über die API kann niemand Einträge schreiben, ändern oder löschen.

Das Protokoll wächst mit jeder Reservierung und Statusmeldung. Ältere Einträge lassen sich in der Cloudflare-Konsole (D1 > poinderecharge-db > Console) löschen, z. B. `delete from audit_log where at < '2025-10-12';`.

## Werbe-Popup („Publicité“)

- Erscheint jedes Mal, wenn man die Karte öffnet oder zur Karte zurückkehrt; auf anderen Seiten (Backoffice, Betreiber, Login, Reservierungen, Kontakt, Rechtstexte) nie.
- Läuft keine Werbung (keine aktiv oder außerhalb des Zeitraums), erscheint nichts. Sind mehrere aktiv, zeigt die App die zuletzt geänderte.
- Schließen per ×, Tippen neben das Fenster oder Zurück/Escape. Der Button öffnet den Link in einem neuen Tab; nur `https://`- und `http://`-Links werden angenommen.
- Tabelle `promotions` in D1 (lesen darf jeder nur die laufende Werbung, ändern nur Admins). Bilder liegen im R2-Bucket `poinderecharge-media` und werden unter `/api/media/…` ausgeliefert (max. 2 MB, PNG/JPG/WebP/GIF, hochladen nur Admins). Änderungen stehen im Aktivitätsprotokoll.
- Logik in `src/lib/promo.ts` (Tests in `src/lib/__tests__/promo.test.ts`), Fenster in `src/components/promo-popup.tsx`.

## Demo-Modus

Im Demo-Modus (`npm run dev`) zeigt das Backoffice Beispielnutzer, eine Reservierungshistorie der letzten zwei Wochen (inkl. eines Fahrers, der dreimal nicht erschienen ist) und protokolliert eigene Änderungen im Browser. Anmeldung als Admin: Code `123456`, Rolle „Administrateur“. Eine Beispiel-Werbung („1ère recharge offerte“) ist angelegt, aber ausgeschaltet; Bilder bleiben im Demo-Modus im Browser (max. 500 KB).
