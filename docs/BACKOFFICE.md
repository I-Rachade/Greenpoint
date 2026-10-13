# Backoffice (Admin-Dashboard)

Erreichbar unter `/admin`, nur für Nutzer mit Rolle `admin`. Alle Seiten aktualisieren sich live (bei jeder Status- oder Reservierungsänderung und alle 30 Sekunden).

| Seite | Inhalt |
|---|---|
| **Tableau de bord** `/admin` | Kennzahlen (Stationen, unbestätigte Status, laufende Reservierungen, Reservierungen 7 Tage, Abschluss- und Nichterscheinen-Quote, Nutzer, vernetzte Steckdosen), Reservierungen pro Tag (14 Tage) und die Liste „À vérifier“ mit Auffälligkeiten |
| **Stations** `/admin/stations` | Status aller Stationen inkl. deaktivierter: offen/zu, Zähler gegen Kapazität, gehaltene Reservierungen, wann zuletzt bestätigt, zugeordnetes Personal; Stationen (de)aktivieren; vernetzte Steckdosen mit letztem Signal; darunter der Stations-Editor mit den Punkten der Station (siehe unten) |
| **Réservations** `/admin/reservations` | Reservierungen der letzten 30 Tage, filterbar nach Status, Station und Telefon/Name; laufende Reservierungen stornieren |
| **Utilisateurs** `/admin/users` | Alle Nutzer mit Rolle (änderbar, außer der eigenen; Menü und Rechte folgen der Rolle: wer `operator` verliert, verliert auch alle Stationen und Betreiber-Konten, wer einer Station oder einem Betreiber zugeordnet wird, wird `operator`, wer keine mehr hat, wieder Kunde), zugeordneten Stationen (zuordnen/entfernen), Reservierungen und Nichterscheinen in 30 Tagen, letzter Login |
| **Activité** `/admin/activity` | Aktivitätsprotokoll: wer hat wann was geändert, filterbar nach Bereich, Station und Person |
| **Exploitants** `/admin/operators` | Betreiber anlegen und umbenennen, Anzahl Stationen, Betreiber-Konten verknüpfen und entfernen (per Telefon oder E-Mail eines bestehenden Kontos). Welche Stationen zu einem Betreiber gehören, wird im Stations-Editor gewählt. Das Konto sieht danach „Mes stations“ (`/exploitant`): Personal seiner Stationen hinzufügen und entfernen, Öffnungszeiten und Telefon ändern, Status und Reservierungen wie Personal |
| **Partenaires API** `/admin/partners` | Partner-Apps anlegen, API-Schlüssel erstellen und sperren, Webhook-Adresse und Secret, Pakete und Summe der letzten 30 Tage, letzte Webhooks mit Zustellstatus; siehe [PARTNER-API.md](PARTNER-API.md) |
| **Publicité** `/admin/promotions` | Werbung, die beim Öffnen der App als Fenster erscheint: Titel, Text, Bild, optionaler Button mit Link, aktiv/inaktiv, Zeitraum; mit Vorschau |
| **Chauffeurs** `/admin/drivers` | Fahrer-Bewerbungen mit Ausweis-, Führerschein- und Porträtfoto; Freigabe mit Zuteilung eines unserer Fahrzeuge, Ablehnen, Sperren; Kassenstand je Fahrer; alle Fahrten (manuell zuteilen, stornieren, Foto an der Tür); Fahrzeuge (Typ, Kennzeichen, in Betrieb); Preise und Regeln |

## Punkte einer Station

Jede Station bietet einen oder mehrere dieser Punkte an, frei kombinierbar (`src/lib/station-points.ts`, Migration `0013_station_points.sql`):

| Punkt | Gespeichert in | Hinweis |
|---|---|---|
| Point d'échange de batterie | `stations.kind` `swap`/`both`, `battery_capacity` | Personal meldet volle Akkus |
| Point de recharge de batterie | `stations.kind` `charging`/`both` | Die Ladeplätze sind die vernetzten Steckdosen der Station (eine pro Ausgang); `charging_slots` zählt der Worker selbst. Eine neue Steckdose macht die Station automatisch zum Ladepunkt. |
| Point de dépôt de colis | `parcel_depots.is_active`, `has_counter` | Personal nimmt Pakete am Schalter an und gibt sie aus |
| Casiers colis | `parcel_depots.is_active`, `lockers` | Fächer, die der Empfänger mit seinem Code öffnet |

Eine Station ohne Tausch und Laden ist ein reiner Paketpunkt (`has_battery = 0`, in der App `kind = "parcel"`). Sie hat keine Zähler, erscheint in der App mit dem Filter „Colis“ und verschwindet aus der App, solange das Paketmodul aus ist. Eine Station ohne jeden Punkt lässt sich nicht speichern.

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
| Viele Reservierungen | ein Kunde mit 3 oder mehr Reservierungen in 24 Std. (Stornieren und neu Reservieren) | À surveiller |
| Nichterscheinen | ein Kunde mit 2 oder mehr abgelaufenen Reservierungen in 7 Tagen | À surveiller |
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

## Fahrer („Chauffeurs“)

- Plan und Abläufe: `planung/fahrer.md` (Projektordner). Code: `src/lib/drivers.ts` (Preise, Zuteilung, Kasse), `worker/drivers.ts`, Migration `0007_drivers.sql`.
- Ein Fahrer ist ein normales Konto mit einer Zeile in `drivers`; er bewirbt sich in der App unter `/chauffeur`. Freigeben geht erst, wenn alle drei Fotos da sind und ein freies Fahrzeug gewählt ist.
- Die Fotos liegen privat im R2-Bucket unter `drivers/…` bzw. `proofs/…` und sind nur für Admins über `/api/admin/driver-files/…` abrufbar.
- Preise und Regeln (Grundpreis, pro km, Express-Zuschlag, Fahreranteil, Kassengrenze, Wartezeit an der Tür, Zeit zum Annehmen, Abstand zur Station für die Warteschlange, was jedes Fahrzeug tragen darf) gelten sofort für neue Fahrten.
- Kasse: Bargeld, das der Fahrer kassiert, minus sein Anteil, minus Abrechnungen. Ab der Kassengrenze bekommt er keine Fahrten mehr, bis eine Station abrechnet (QR-Code des Fahrers scannen, „Encaisser“ bzw. „Payer“).
- Flottenmanager: In der Spalte **Gestionnaire de flotte** ordnet der Admin einen Fahrer per Telefon oder E-Mail einem Konto zu (höchstens ein Manager je Fahrer, Tabelle `fleet_manager_drivers`, Migration `0015_fleet_managers.sql`). Ein Kunde wird dabei zum Flottenmanager; verliert er seinen letzten Fahrer, wird er wieder Kunde. Personal einer Station kann kein Flottenmanager sein (eine Rolle pro Person). Setzt der Admin die Rolle von Hand weg von Flottenmanager, fallen alle Zuordnungen weg.
- Der Flottenmanager sieht unter **Ma flotte** (`/flotte`) seine Fahrer mit Fahrzeug, Warteschlange, Kasse und laufender Fahrt. Offene Fahrten gibt er einem seiner Fahrer an der Warteschlange vorbei; der Fahrer bestätigt wie sonst. Die Kontaktdaten der Kunden sieht er nicht. Pro Zeitraum sieht er je Fahrer erledigte und gescheiterte Fahrten, Einnahmen, Fahreranteil, kassiertes und abgegebenes Bargeld, Batteriewechsel und Ladeplätze (abgeschlossene Reservierungen) und was davon in der App bezahlt wurde. Code: `src/lib/fleet.ts`, `worker/fleet.ts`. Jede Zuordnung und jede Zuteilung steht im Aktivitätsprotokoll.

## Demo-Modus

Im Demo-Modus (`npm run dev`) zeigt das Backoffice Beispielnutzer, eine Reservierungshistorie der letzten zwei Wochen (inkl. eines Kunden, der dreimal nicht erschienen ist) und protokolliert eigene Änderungen im Browser. Anmeldung als Admin: Code `123456`, Rolle „Administrateur“. Eine Beispiel-Werbung („1ère recharge offerte“) ist angelegt, aber ausgeschaltet; Bilder bleiben im Demo-Modus im Browser (max. 500 KB).
