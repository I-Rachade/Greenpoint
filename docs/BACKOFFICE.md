# Backoffice (Admin-Dashboard)

Erreichbar unter `/admin`, nur für Nutzer mit Rolle `admin`. Alle Seiten aktualisieren sich live (bei jeder Status- oder Reservierungsänderung und alle 30 Sekunden).

## Eigene Adresse: admin.poinderecharge.com (Cloudflare Access)

Das Backoffice bekommt eine eigene Adresse, vor der **Cloudflare Access** steht: Erst nach der Anmeldung bei Access (E-Mail-Code und Fingerabdruck oder Face ID) lädt überhaupt eine Seite. Dahinter folgt wie bisher der Login mit Nummer und PIN.

So hängt es zusammen:

- **Worker `pointderecharge-admin`** (`wrangler.admin.jsonc`, Code `worker/admin-gateway.ts`): prüft bei jeder Anfrage den Ausweis von Access (Header `Cf-Access-Jwt-Assertion`, RS256-signiert, `worker/access.ts`), liefert die Seiten aus `out/` und gibt `/api/*` per Service Binding an `pointderecharge-app` weiter. Ohne `ACCESS_TEAM_DOMAIN` und `ACCESS_AUD` antwortet er nur mit 503.
- **API** (`pointderecharge-app`): Ist dort `ADMIN_ACCESS_REQUIRED=1` gesetzt, bekommt ein Admin-Konto nur noch mit gültigem Access-Ausweis eine Sitzung, und eine bestehende Admin-Sitzung gilt nur bei Anfragen mit Ausweis. Eine gestohlene PIN oder ein abgefangener SMS-Code reichen dann nicht mehr; über `app.poinderecharge.com` und die Handy-Apps kommt kein Admin mehr hinein (Meldung `admin_access_required`). Kunden, Personal und alle anderen Rollen merken nichts davon.
- Solange `ADMIN_ACCESS_REQUIRED` nicht gesetzt ist, ändert sich am bisherigen `/admin` nichts. So lässt sich die neue Adresse erst ausprobieren und dann scharf schalten.

### Einrichten (einmalig, im Cloudflare-Dashboard)

1. **Zero Trust aktivieren:** Dashboard > **Zero Trust**. Beim ersten Öffnen einen Team-Namen wählen (z. B. `poinderecharge`) und den **Free**-Plan (bis 50 Nutzer). Die Team-Domain ist dann `https://<team>.cloudflareaccess.com`.
2. **Admin-Worker anlegen:** **Workers & Pages > Create > Continue with GitHub**, dasselbe Repository und dasselbe API-Token wie bei `pointderecharge-app`, Name `pointderecharge-admin`, Build command leer, Deploy command `npx wrangler deploy -c wrangler.admin.jsonc`, Variable `NODE_VERSION` = `22`. Der Assistent baut zuerst den Standard-Branch des Repos, in dem die App fehlt; dieser erste Build scheitert (`Could not read file: wrangler.admin.jsonc`). Danach unter **Settings > Build > Branch control** den Production branch wie bei `pointderecharge-app` setzen; der nächste Push auf diesen Branch baut den Worker. Der erste Deploy legt `admin.poinderecharge.com` an; die Seite antwortet bis Schritt 4 mit 503.
3. **Access vor den Worker stellen:** **Workers & Pages > pointderecharge-admin > Domains** (bzw. **Settings > Domains & Routes**) > **Cloudflare Access** einschalten, für Produktion und Previews. Bei „Wer darf sich anmelden“ nur die eigene E-Mail-Adresse eintragen. Danach unter **Zero Trust > Access controls > Applications** die neue Anwendung öffnen und den **Application Audience (AUD) Tag** kopieren.
4. **Werte eintragen**, jeweils unter **Settings > Variables and secrets** (Laufzeit, nicht Build):
   - bei `pointderecharge-admin`: `ACCESS_TEAM_DOMAIN` = `https://<team>.cloudflareaccess.com`, `ACCESS_AUD` = der AUD-Tag
   - bei `pointderecharge-app`: dieselben zwei Werte (noch **ohne** `ADMIN_ACCESS_REQUIRED`)
5. **Fingerabdruck dazu (empfohlen):** **Zero Trust > Access controls > Access settings > Allow multi-factor authentication**, „Biometrics“ (und gern „Security key“) erlauben; in der Anwendung aus Schritt 3 MFA verlangen. Gerät anmelden unter `https://<team>.cloudflareaccess.com/AddMfaDevice`.
6. **Turnstile:** Im Turnstile-Widget den Hostnamen `admin.poinderecharge.com` ergänzen, sonst schlägt der Login-Code dort fehl.
7. **Testen:** `https://admin.poinderecharge.com` öffnen, bei Access anmelden, dann wie gewohnt mit Nummer und PIN. In einem privaten Fenster ohne Access-Anmeldung muss „Access denied“ bzw. die Access-Anmeldeseite kommen.
8. **Scharf schalten** (erst wenn Schritt 7 klappt): bei `pointderecharge-app` `ADMIN_ACCESS_REQUIRED` = `1` setzen. Ab dann geht das Backoffice nur noch über `admin.poinderecharge.com`. Zurück: den Wert löschen.

## Seiten

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

## Version der App: Komplett oder Lite

Oben im Tableau de bord schaltet „Version de l'app“ zwischen der kompletten App (Version 2.0) und der **Lite-Version** um. Lite zeigt nur Karte, Stationen, Reservierungen und Konto; Pakete, Fahrten („Courses“), Cashplus und Ladesäulen für Elektroautos verschwinden für alle Nutzer. Der Server sperrt die zugehörigen Schnittstellen ebenfalls, sodass auch ältere App-Versionen sie nicht mehr zeigen.

Lite ist ein eigener Schalter (`app_settings.lite_mode`) und ändert die Modul-Schalter für Pakete, Fahrer und Portefeuille nicht. Wer Lite wieder ausschaltet, bekommt genau die Module zurück, die vorher an waren. Solange Lite an ist, zeigen die Seiten Colis, Chauffeurs, Portefeuille und Bornes VE einen Hinweis statt des Modul-Schalters; ihre Daten bleiben im Backoffice erreichbar. Jede Umschaltung steht im Aktivitätsprotokoll unter „Réglages de l'app“.

## Punkte einer Station

Jede Station bietet einen oder mehrere dieser Punkte an, frei kombinierbar (`shared/station-points.ts`, Migration `0013_station_points.sql`):

| Punkt | Gespeichert in | Hinweis |
|---|---|---|
| Point d'échange de batterie | `stations.kind` `swap`/`both`, `battery_capacity`, `station_battery_types` | Personal meldet volle Akkus. Dazu die Akku-Typen, die getauscht werden (siehe unten) |
| Point de recharge de batterie | `stations.kind` `charging`/`both` | Die Ladeplätze sind die vernetzten Steckdosen der Station (eine pro Ausgang); `charging_slots` zählt der Worker selbst. Eine neue Steckdose macht die Station automatisch zum Ladepunkt. |
| Point de dépôt de colis | `parcel_depots.is_active`, `has_counter` | Personal nimmt Pakete am Schalter an und gibt sie aus |
| Casiers colis | `parcel_depots.is_active`, `lockers` | Fächer, die der Empfänger mit seinem Code öffnet |

Eine Station ohne Tausch und Laden ist ein reiner Paketpunkt (`has_battery = 0`, in der App `kind = "parcel"`). Sie hat keine Zähler, erscheint in der App mit dem Filter „Colis“ und verschwindet aus der App, solange das Paketmodul aus ist. Eine Station ohne jeden Punkt lässt sich nicht speichern.

### Akku-Typen (Types de batterie)

Jede Motorrad-Marke (Akku-Betreiber, z. B. Spiro oder Omnivoltaic) hat eigene Tausch-Akkus. Oben im Stations-Editor pflegt der Admin die Liste (Marke und Modell, abschaltbar), im Tauschpunkt jeder Station hakt er an, welche Typen dort getauscht werden (Tabellen `battery_types`, `station_battery_types`, Migration `0017_battery_types.sql`). Pro Typ zählt das Stationspersonal die vollen Akkus (Spalte `station_battery_types.full_batteries`); der Gesamtwert der Station (`station_status.full_batteries`) ist dann ihre Summe. Laden braucht keinen Typ: die Steckdosen laden jeden Akku. Die App zeigt die getauschten Typen mit ihren vollen Akkus in der Stationsansicht und filtert nach Marke; abgeschaltete Typen erscheinen dort nicht.

### Akku-Register (Batteries)

Unter **Batteries** (`/admin/batteries`) steht jeder getauschte Akku mit seiner Nummer, pro Marke, mit eigener Historie (Tabellen `batteries`, `battery_history`, Migration `0041_batteries.sql`). Ein Akku kommt auf zwei Wegen in die Liste: der Admin trägt Nummern für einen Akku-Typ vorab ein (einzeln oder als eingefügte Liste), oder der erste Tausch, der eine unbekannte Nummer scannt, legt ihn mit dem Typ des Tauschs an („Ajoutée au swap“). Eine Nummer ist pro Marke eindeutig; eine Nummer, die unter einer anderen Marke eingetragen ist, lehnt der Tausch ab. An Stationen mit Akku-Typen sind die Nummern beim Tausch Pflicht (der ausgegebene Akku, und der zurückgebrachte außer beim Erstkauf); das Tauschformular zeigt unter jeder Nummer, ob der Akku bekannt, neu oder einer anderen Marke ist. Die Historie zeigt Eintrag, Ausgabe an den Kunden, Rückgabe an der Station und Statuswechsel (in Betrieb, in Reparatur, verloren, ausgemustert; nur Admin, mit Grund). Betreiber sehen im Tab „Batteries“ ihres Backoffice die Akkus, die durch ihre Stationen gingen, nur lesend und ohne die Personen fremder Stationen. Code: `shared/batteries.ts`, `worker/batteries.ts`.

### Fotos, Rastplatz und Bewertungen

Im Stations-Editor lädt der Admin bis zu 6 Fotos hoch (R2, Ordner `stations/`); das erste ist das Titelbild in der App, „Mettre en couverture“ macht ein anderes zum Titelbild. Ohne Foto zeigt die App eine Illustration (`public/station-photos/`). Darunter hakt er an, was die Station zum Ausruhen und an Diensten bietet (Bänke, Schatten, Toiletten, Trinkwasser, Essen, Getränke, WLAN, Handy laden, Laden, Parkplatz; `shared/station-extras.ts`). Hat eine Station Bänke, Schatten, Toiletten, Wasser, Essen oder Getränke, trägt sie in der App das Abzeichen „Point de repos“. Gespeichert in `stations.photos` und `stations.amenities` (JSON, Migration `0021_station_photos_reviews.sql`).

Angemeldete Kunden bewerten eine Station mit 1 bis 5 Sternen und einem Kommentar (höchstens 500 Zeichen); pro Kunde und Station gibt es eine Bewertung, eine neue ersetzt die alte (Tabelle `station_reviews`). Die App zeigt Durchschnitt, Verteilung und die neuesten Bewertungen mit Vorname und Initiale. Im Stations-Editor sieht der Admin alle Bewertungen der Station und löscht beleidigende; das Löschen steht im Aktivitätsprotokoll.

## Ladesäulen für Elektroautos („Bornes VE“)

Unter `/admin/ev-chargers` legt der Admin Ladesäulen für Elektroautos an (Name, Stecker Type 2 / CCS2 / CHAdeMO / GB/T, Leistung in kW) und weist jede einer Station zu, direkt in der Liste über das Auswahlfeld. Eine Station mit mindestens einer aktiven zugewiesenen Säule zeigt in der App das Abzeichen „Voiture électrique“, ihre Säulen in der Stationsansicht und erscheint im Filter „Voiture électrique“. Nicht zugewiesene Säulen werden oben gezählt. Migration `0020_ev_chargers.sql`, Code `shared/ev-chargers.ts`, `worker/ev-chargers.ts`.

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
- Logik in `shared/promo.ts` (Tests in `src/lib/__tests__/promo.test.ts`), Fenster in `src/components/promo-popup.tsx`.

## Fahrer („Chauffeurs“)

- Plan und Abläufe: `planung/fahrer.md` (Projektordner). Code: `shared/drivers.ts` (Preise, Zuteilung, Kasse), `worker/drivers.ts`, Migration `0007_drivers.sql`.
- Ein Fahrer ist ein normales Konto mit einer Zeile in `drivers`; er bewirbt sich in der App unter `/chauffeur`. Freigeben geht erst, wenn alle drei Fotos da sind und ein freies Fahrzeug gewählt ist.
- Die Fotos liegen privat im R2-Bucket unter `drivers/…` bzw. `proofs/…` und sind nur für Admins über `/api/admin/driver-files/…` abrufbar.
- Preise und Regeln (Grundpreis, pro km, Express-Zuschlag, Fahreranteil, Kassengrenze, Wartezeit an der Tür, Zeit zum Annehmen, Abstand zur Station für die Warteschlange, was jedes Fahrzeug tragen darf) gelten sofort für neue Fahrten.
- Kasse: Bargeld, das der Fahrer kassiert, minus sein Anteil, minus Abrechnungen. Ab der Kassengrenze bekommt er keine Fahrten mehr, bis eine Station abrechnet (QR-Code des Fahrers scannen, „Encaisser“ bzw. „Payer“).
- Flottenmanager: In der Spalte **Gestionnaire de flotte** ordnet der Admin einen Fahrer per Telefon oder E-Mail einem Konto zu (höchstens ein Manager je Fahrer, Tabelle `fleet_manager_drivers`, Migration `0015_fleet_managers.sql`). Ein Kunde wird dabei zum Flottenmanager; verliert er seinen letzten Fahrer, wird er wieder Kunde. Personal einer Station kann kein Flottenmanager sein (eine Rolle pro Person). Setzt der Admin die Rolle von Hand weg von Flottenmanager, fallen alle Zuordnungen weg.
- Der Flottenmanager sieht unter **Ma flotte** (`/flotte`) seine Fahrer mit Fahrzeug, Warteschlange, Kasse und laufender Fahrt. Offene Fahrten gibt er einem seiner Fahrer an der Warteschlange vorbei; der Fahrer bestätigt wie sonst. Die Kontaktdaten der Kunden sieht er nicht. Pro Zeitraum sieht er je Fahrer erledigte und gescheiterte Fahrten, Einnahmen, Fahreranteil, kassiertes und abgegebenes Bargeld, Batteriewechsel und Ladeplätze (abgeschlossene Reservierungen) und was davon in der App bezahlt wurde. Code: `shared/fleet.ts`, `worker/fleet.ts`. Jede Zuordnung und jede Zuteilung steht im Aktivitätsprotokoll.

## Demo-Modus

Im Demo-Modus (`npm run dev`) zeigt das Backoffice Beispielnutzer, eine Reservierungshistorie der letzten zwei Wochen (inkl. eines Kunden, der dreimal nicht erschienen ist) und protokolliert eigene Änderungen im Browser. Anmeldung als Admin: Code `123456`, Rolle „Administrateur“. Eine Beispiel-Werbung („1ère recharge offerte“) ist angelegt, aber ausgeschaltet; Bilder bleiben im Demo-Modus im Browser (max. 500 KB).
