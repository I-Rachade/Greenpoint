# Backoffice (Admin-Dashboard)

Erreichbar unter `/admin`, nur für Nutzer mit Rolle `admin`. Alle Seiten aktualisieren sich live (bei jeder Status- oder Reservierungsänderung und alle 30 Sekunden).

| Seite | Inhalt |
|---|---|
| **Tableau de bord** `/admin` | Kennzahlen (Stationen, unbestätigte Status, laufende Reservierungen, Reservierungen 7 Tage, Abschluss- und Nichterscheinen-Quote, Nutzer, vernetzte Steckdosen), Reservierungen pro Tag (14 Tage) und die Liste „À vérifier“ mit Auffälligkeiten |
| **Stations** `/admin/stations` | Status aller Stationen inkl. deaktivierter: offen/zu, Zähler gegen Kapazität, gehaltene Reservierungen, wann zuletzt bestätigt, zugeordnetes Personal; Stationen (de)aktivieren; vernetzte Steckdosen mit letztem Signal; darunter der bisherige Stations-Editor |
| **Réservations** `/admin/reservations` | Reservierungen der letzten 30 Tage, filterbar nach Status, Station und Telefon/Name; laufende Reservierungen stornieren |
| **Utilisateurs** `/admin/users` | Alle Nutzer mit Rolle (änderbar, außer der eigenen), zugeordneten Stationen (zuordnen/entfernen), Reservierungen und Nichterscheinen in 30 Tagen, letzter Login |
| **Activité** `/admin/activity` | Aktivitätsprotokoll: wer hat wann was geändert, filterbar nach Bereich, Station und Person |

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

Migration `supabase/migrations/20261012000400_backoffice.sql`:

- Tabelle `audit_log`: Zeitpunkt, wer (`actor` = `auth.uid()`, leer = System, z. B. Steckdosen-Webhook oder SQL-Editor), Tabelle, Aktion, betroffene Station und betroffener Nutzer, und die Änderung (`{Spalte: [alt, neu]}` bzw. die ganze Zeile beim Anlegen/Löschen).
- Ein Trigger `audit_row()` schreibt bei jeder Änderung an `profiles`, `operators`, `stations`, `station_status`, `station_staff`, `reservations` und `charging_points`. Spalten, die sich von selbst ändern (`updated_at`, `last_seen_at`, `power_watts`, `energy_wh` …), zählen nicht; ein Herzschlag einer Steckdose ohne echte Änderung schreibt also nichts.
- Lesen dürfen nur Admins (RLS). Schreiben, Ändern und Löschen über die API ist für alle gesperrt, auch für Admins; nur der Trigger schreibt.
- Funktion `admin_list_users()` liefert die Profile mit letztem Login aus `auth.users` (nur für Admins).

Das Protokoll wächst mit jeder Reservierung und Statusmeldung. Ältere Einträge lassen sich im SQL-Editor löschen, z. B. `delete from audit_log where at < now() - interval '1 year';`.

## Demo-Modus

Ohne Supabase-Schlüssel zeigt das Backoffice Beispielnutzer, eine Reservierungshistorie der letzten zwei Wochen (inkl. eines Fahrers, der dreimal nicht erschienen ist) und protokolliert eigene Änderungen im Browser. Anmeldung als Admin: Code `123456`, Rolle „Administrateur“.
