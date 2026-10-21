# Share: Fahrzeuge von Station zu Station

Kunden leihen an einer Share-Station ein E-Motorrad (später E-Scooter und Autos) und geben es im
Radius **irgendeiner** Share-Station zurück. Das Ziel bei der Reservierung dient nur der Planung.
Bezahlt wird nach der Fahrt: Flooz/T-Money, Green Credit (mit PIN) oder bar beim Personal der
Station, an der die Fahrt endete.

Code: `src/lib/share.ts` (Typen, Preisberechnung), `worker/share.ts` (Server),
`worker/tutrack.ts` (Tracker-API), `worker/tutrack-bridge.ts` und `worker/mqtt.ts` (MQTT-Push),
Migration `worker/migrations/0060_share.sql`. App: `/share` (Tab „Share“, ersetzt den Tab
„Stations“, solange Share an ist; die Stationsliste bleibt über die Karte erreichbar),
Personal: `/operator/share`, Backoffice: `/admin/share`.

## Einschalten

1. Migration anwenden: `npm run db:migrate` (legt nur Tabellen, Spalten und Zeilen an).
2. Worker deployen (der neue Durable Object `TutrackBridge` kommt mit `wrangler.jsonc`, Migration `v2`).
3. Im Backoffice unter **Share**:
   - **Stationen**: „Share“ anhaken, Radius (Standard 50 m, 10–500 m) und Leihhelme eintragen.
   - **Tarife**: Preise in FCFA je Fahrzeugtyp setzen und „Aktiv“ anhaken. Ohne aktiven Tarif
     kann der Typ nicht gemietet werden. Laufende Fahrten behalten ihren Preis.
   - **Fahrzeuge**: anlegen (Heimatstation, Tutrack-ID), dann auf „Verfügbar“ an einer Station setzen.
   - Schalter **Module Share activé** einschalten. In der Lite-Version bleibt Share verborgen.
4. Kunden schicken einmal Ausweis und Selfie (Autos zusätzlich den Führerschein); ein Admin
   gibt sie unter **Vérifications** frei.

## Preis

Entsperren + Minuten in Fahrt × Minutenpreis + Minuten in Pause × Pausenpreis; jede angefangene
Minute zählt. Beendet ein Admin eine Fahrt außerhalb einer Station, kann er die Gebühr
„Rückgabe außerhalb“ dazunehmen. Die Kaution wird nur angezeigt.

## Green Credit

Eine Share-Fahrt wird mit der PIN vom Green Credit abgebucht, wenn der Kunde Green Credit nutzen
darf (Modul an oder Admin zum Testen) und das Guthaben reicht. Die Buchung steht in
`wallet_transactions` als Typ `trip` („Course“) mit der Fahrt in `details`. Ein eigener Typ hätte
einen Neubau der Tabelle verlangt, der die Trigger anderer Migrationen löscht.
Hinweis: die CGU beschreiben Green Credit bisher als Guthaben für Energie; der Text sollte die
Share-Fahrten mit aufnehmen.

## Tutrack (GPS-Tracker und Zündsperre)

Ohne Zugangsdaten laufen die Tracker **simuliert**: Befehle gelingen von selbst, und während der
Fahrt schickt das Handy des Kunden seine Position (für die Rückgabeprüfung und die Strecke).
Das Backoffice zeigt dann einen Hinweis.

Für echte Tracker im Cloudflare-Dashboard (Worker > Settings > Variables and secrets) setzen,
**nie ins Repository**:

| Name | Typ | Inhalt |
|---|---|---|
| `SHARE_TRACKER_PROVIDER` | Text | `tutrack` |
| `TUTRACK_ACCESS_KEY` | Secret | AccessKey der Tutrack Open API |
| `TUTRACK_ACCESS_SECRET` | Secret | AccessSecret der Tutrack Open API |
| `TUTRACK_BASE_URL` | Text, optional | Standard `https://openapi-ent.tqiot.com` |
| `TUTRACK_ENT_ID` | Text | Enterprise-ID; das Push-Thema ist `server/ent/<ID>` |
| `TUTRACK_MQTT_USER`, `TUTRACK_MQTT_PASSWORD` | Text, Secret | MQTT-Zugang von Tutrack |
| `TUTRACK_MQTT_HOST`, `TUTRACK_MQTT_PORT`, `TUTRACK_MQTT_TLS` | Text, optional | Standard `pub.ent.tqiot.com`, `2883`, ohne TLS (`1` für TLS) |

Die Befehle zum Entsperren und Sperren der Zündung (`cmdCategoryCode`) hängen vom Gerät ab: im
Backoffice je Fahrzeug eintragen (Liste der Befehle eines Geräts: Tutrack-API „cmd list“) und mit
„Tester déverrouillage / verrouillage“ prüfen. Ohne eingetragenen Befehl schlägt die Fahrt beim
Start fehl, statt ein Fahrzeug ohne Sperre freizugeben.

Positionen, Online-Status und Alarme kommen per MQTT. Ein Durable Object hält die Verbindung,
pingt alle 30 Sekunden und verbindet neu; der Minuten-Cron weckt ihn, falls er stehen bleibt.
Alarme eines geparkten Fahrzeugs (Erschütterung, Abbau, Strom weg, Zaun verlassen, Zündung) werden
zu Vorfällen im Backoffice, höchstens einer je halbe Stunde und Fahrzeug.

## Zeiten

- Reservierung: 10 Minuten, danach wird das Fahrzeug wieder frei (Minuten-Cron und bei jeder Aktion).
- Fahrten über 6 Stunden erzeugen einmal einen Vorfall „Trajet très long“.
