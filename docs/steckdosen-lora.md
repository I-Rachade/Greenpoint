# Verbundene Steckdosen (LoRa)

poinderecharge kann den Status von vernetzten Ladesteckdosen live anzeigen, z. B. LoRa-Doppelsteckdosen zum Selbstladen von E-Scootern. Jeder Ausgang ist ein Ladeplatz (`charging_points`). Die Steckdose meldet, ob ein Ausgang frei ist, lädt, fertig ist oder gestört ist; die App zeigt das sofort auf der Stationsseite und zählt die freien Plätze automatisch.

Steckdosen mit dem Xingke-Protokoll (Hersteller der Alibaba-Doppelsteckdose) lassen sich außerdem fernschalten: ein Admin schaltet einen Ausgang ein oder aus, über die [Xingke-Cloud-API](#xingke-cloud-api) oder das [Textprotokoll](#xingke-protokoll-v11-über-eine-brücke). Abrechnung pro Ladevorgang kommt in Phase 2 mit der Bezahlung. Hintergrund: `planung/lora-ladesteckdose.md`, Protokoll auf Englisch: `planung/xingke-16-port-protocol-v1.1-en.md` im Projektordner.

## Aufbau

```
Steckdose --LoRa--> Gateway --4G--> Netzwerkserver (TTN / ChirpStack)
                                    oder Hersteller-Cloud
                                          |
                                          v  HTTPS + Schlüssel
                     Worker pointderecharge-app: POST /api/devices/events
                                          |
                                          v
                     D1 poinderecharge-db: charging_points, station_status
                                          |
                                          v  Abfrage alle 15 s
                                        App
```

- `worker/migrations/0003_devices.sql`: Tabellen `devices` und `device_messages`, Spalten `outlet` und `energy_wh` an `charging_points`.
- `worker/devices.ts`: nimmt Meldungen an, legt Geräte an, zählt freie Plätze.
- `src/lib/iot/device-events.ts`: liest die Formate (wird auch in den Tests geprüft).
- `src/lib/iot/charging-points.ts`: "offline", wenn ein Gerät 15 Minuten nichts meldet.
- `worker/migrations/0004_device_commands.sql`: Warteschlange für Schaltbefehle (`device_commands`).
- `src/lib/iot/xingke-commands.ts`: baut die Xingke-Befehle des Textprotokolls (Ausgang ein/aus).
- `src/lib/iot/xingke-cloud.ts` und `worker/xingke.ts`: Befehle und Callbacks der Xingke-Cloud-API.

## Einrichten

1. Migration einspielen: `npx wrangler d1 migrations apply DB --remote`.
2. Schlüssel setzen: im Cloudflare-Dashboard unter **Workers > pointderecharge-app > Settings > Variables and secrets** ein Secret `DEVICE_WEBHOOK_SECRET` mit einem langen zufälligen Wert anlegen. Ohne Schlüssel lehnt der Worker alle Meldungen ab (503).
3. Gerät anlegen: im Backoffice unter **Admin > Prises connectées > Ajouter une prise** Geräte-ID, Station, Anzahl der Ausgänge, Verbindung und Hersteller eintragen. Das legt pro Ausgang einen Ladeplatz an, bezeichnet `<letzte 4 Zeichen>-<Ausgang>`. Auf derselben Seite lässt sich eine Steckdose wieder löschen (samt Ladeplätzen) und bei Xingke-Steckdosen jeder Ausgang ein- und ausschalten. Ohne App geht es auch per API:
   ```bash
   curl -X POST https://app.poinderecharge.com/api/admin/devices \
     -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" \
     -d '{"externalId":"A84041000181F0A1","stationId":"<station-id>","vendor":"Hersteller","model":"Modell","link":"lorawan","outlets":2}'
   ```
   (`GET /api/admin/devices` listet die Geräte, `DELETE /api/admin/devices/<id>` löscht eins.) Danach bei Bedarf die Bezeichnungen der Ladeplätze an die Aufkleber neben dem QR-Code anpassen (D1-Konsole: `update charging_points set label = 'A1' where device_id = '…' and outlet = 1;`) und `charging_slots` der Station auf die Anzahl der Ausgänge setzen.
4. Netzwerkserver oder Hersteller-Cloud auf den Worker zeigen lassen:
   - URL: `https://app.poinderecharge.com/api/devices/events?format=ttn` (oder `chirpstack`, `generic`)
   - Header: `X-Device-Key: <DEVICE_WEBHOOK_SECRET>`

## Formate

Alle Formate liefern am Ende dieselbe Liste `outlets`:

```json
{ "outlets": [ { "outlet": 1, "status": "charging", "power_watts": 180, "energy_wh": 420 },
               { "outlet": 2, "status": "free" } ] }
```

- `status`: `free`, `charging`, `done`, `fault` (auch `idle`, `on`, `full`, `error` u. ä. werden verstanden). Fehlt er, entscheidet die Leistung: über 5 W = lädt.
- Ohne `outlets` gilt die Meldung als Lebenszeichen.
- Ein reservierter Ausgang bleibt reserviert, auch wenn das Gerät "frei" meldet.
- Geht ein Ausgang auf `charging`, gilt die älteste aktive Platz-Reservierung der Station als eingelöst (`completed`). Sonst würde sie bis zum Ablauf einen zweiten Ausgang blockieren.
- Freie Plätze zählen nur Ausgänge, die in den letzten 15 Minuten gemeldet haben. Eine stumme Steckdose lässt sich weder in der App noch über die API reservieren; ein neu angelegtes Gerät bietet nichts an, bis es sich meldet.
- Die Geräte-ID wird immer groß geschrieben gespeichert und verglichen (ChirpStack zeigt DevEUIs klein).

| `format` | Gerätekennung | Ausgänge |
|---|---|---|
| `generic` | `device` | `outlets` |
| `ttn` | `end_device_ids.dev_eui` | `uplink_message.decoded_payload.outlets` |
| `chirpstack` | `deviceInfo.devEui` | `object.outlets` |
| `xingke` | `EID` (6 Ziffern) | Textzeilen, siehe unten |

Bei LoRaWAN schickt die Steckdose Bytes. Ein Payload-Formatter im Netzwerkserver übersetzt sie in die Liste oben. Beispiel für The Things Network, wenn der Hersteller pro Ausgang 1 Byte Status und 2 Byte Leistung sendet (an das echte Protokoll anpassen):

```js
function decodeUplink(input) {
  var names = ["free", "charging", "done", "fault"];
  var outlets = [];
  for (var i = 0; i + 2 < input.bytes.length; i += 3) {
    outlets.push({
      outlet: i / 3 + 1,
      status: names[input.bytes[i]] || "fault",
      power_watts: (input.bytes[i + 1] << 8) | input.bytes[i + 2],
    });
  }
  return { data: { outlets: outlets } };
}
```

## Xingke-Cloud-API

Seit Oktober 2026 bietet Xingke eine Cloud-API an ("Xingke Unified API V1.0", `planung/xingke-two-wheeler-api-v1.0-en.pdf`): JSON über HTTPS, ohne eigene Brücke. Die Steckdosen hängen an der Xingke-Plattform; wir schicken ihr Befehle, sie schickt uns die Ereignisse der Geräte.

**Einrichten**

1. Von Xingke bekommen: die API-Adresse (`apiHost`), unseren Zugangsschlüssel und die Geräte-ID jeder Steckdose.
2. Am Worker `pointderecharge-app` setzen (Settings > Variables and Secrets):

   | Name | Art | Wert |
   |---|---|---|
   | `XINGKE_API_HOST` | Text | Host ohne `https://`, z. B. `api.xingke.example` |
   | `XINGKE_API_TOKEN` | Secret | unser Zugangsschlüssel für die Befehle |
   | `XINGKE_CALLBACK_TOKEN` | Secret | langer Zufallswert, den Xingke bei jedem Callback als `Authorization: Bearer …` mitschickt |

3. Xingke diese Callback-Adresse und den `XINGKE_CALLBACK_TOKEN` geben: `https://app.poinderecharge.com/api/devices/xingke`
4. Migration `0011_xingke_cloud.sql` anwenden: `npx wrangler d1 migrations apply DB --remote`
5. Im Backoffice unter **Prises connectées** die Steckdose anlegen: Geräte-ID genau wie bei Xingke (Groß-/Kleinschreibung zählt), Verbindung „Cloud du fabricant“, Hersteller „Xingke“ (wird bei dieser Verbindung vorausgefüllt), Zahl der Ausgänge. Nur mit Hersteller „Xingke“ und „Cloud du fabricant“ zeigt das Backoffice „Allumer“ und „Éteindre“.
6. Empfehlung an Xingke bzw. per `ChangeConfiguration`: Statusmeldungen höchstens alle 5 Minuten (`statusNotificationInterval` 300). Ein Ausgang ohne Meldung seit 15 Minuten gilt als offline und wird nicht angeboten.

**Befehle** (`worker/xingke.ts`): „Allumer“ schickt `RemoteStartTransaction` (bis voll, oder `{"minutes":60}` über die API für eine feste Dauer), „Éteindre“ `RemoteStopTransaction` mit der `transactionId` des letzten Starts dieses Ausgangs. Jeder Befehl steht in `device_commands` mit seiner `message_id`; HTTP 202 heißt nur „angenommen“, das Ergebnis kommt als Callback. Lehnt die Plattform ab, weil das Gerät offline oder beschäftigt ist, zeigt das Backoffice das an. Bei Zeitüberschreitung bleibt der Befehl offen, ein späteres Ergebnis schließt ihn noch.

**Callbacks** (`POST /api/devices/xingke`): Jede Meldung wird in `device_messages` gespeichert und mit `{"code":"OK"}` bestätigt, Wiederholungen werden über `device_callbacks` erkannt und nur bestätigt.

| `action` | Wirkung |
|---|---|
| `StatusNotification` | `Available` frei, `Charging` lädt, `Faulted` Störung; `Unknown` und nicht gemeldete Ausgänge bleiben wie sie sind |
| `ChargingStatusNotification` | `Charging` lädt (Leistung in W, Energie von kWh in Wh); `Stopped` mit `Completed`/`BalanceDepleted` fertig, `NoLoad`/`PowerLossOrUnplugged` frei, Schutzabschaltungen Störung |
| `FaultNotification` | `Connector`: dieser Ausgang gestört; `Device`: alle Ausgänge gestört bis zur nächsten Statusmeldung |
| `CommandResult` | schließt den Befehl (`Succeeded`/`Sent` = `done`, `Failed` = `failed`, Code in `result`); ein später `Unknown` überschreibt kein bestätigtes Ergebnis. Start bestätigt = lädt, Stopp bestätigt = frei |
| `DeviceOnline` | Lebenszeichen, Ausgänge wieder angeboten |
| `DeviceOffline` | Ausgänge sofort offline, freie Plätze der Station neu gezählt |
| `CardPresented` | nur gespeichert: die App führt keine Ladekarten, das Gerät bekommt keine Antwort |

Noch offen bei Xingke: Produktionsadresse und Zugangsdaten, ob die Geräte-IDs Kleinbuchstaben enthalten, und ob `energy` pro Ladevorgang oder als Zählerstand gemeldet wird (die App zeigt den gemeldeten Wert). Die JSON-Beispiele, das JSON-Schema und die OpenAPI-Datei des Herstellers liegen unter `src/lib/__tests__/fixtures/xingke/`; die Tests prüfen unsere Befehle und Callbacks dagegen.

## OCPP 1.6J (direkt an unseren Server)

Ladepunkte, die OCPP 1.6J sprechen (auch Xingke-Geräte im „OCPP Mode“), verbinden sich ohne Hersteller-Plattform direkt mit uns. Jeder Ladepunkt hält eine WebSocket-Verbindung zu einem eigenen Durable Object (`OcppConnection` in `worker/ocpp.ts`); der Worker ist das „Central System“.

**Einrichten**

1. Migration `0023_ocpp.sql` anwenden: `npx wrangler d1 migrations apply DB --remote`. Der Durable Object (`OCPP` in `wrangler.jsonc`) entsteht beim nächsten Deploy von selbst.
2. Im Backoffice unter **Prises connectées** die Steckdose anlegen: Kennung des Ladepunkts (Charge Point ID), Verbindung „Notre serveur“, Häkchen „OCPP 1.6J“, Zahl der Ausgänge (= Connectoren).
3. Das Backoffice zeigt danach **einmal** das Passwort (AuthorizationKey). Nur sein Hash wird gespeichert; wer es verliert, löscht die Steckdose und legt sie neu an.
4. Im Ladepunkt eintragen: Central-System-URL `wss://app.poinderecharge.com/api/devices/ocpp`, Charge Point ID wie angelegt, Passwort = AuthorizationKey (HTTP Basic, Security Profile 1). Der Ladepunkt hängt seine ID selbst an die URL an. Unterprotokoll `ocpp1.6`.
5. Die Cloudflare-Regel, die `/api/devices/` von Browser Integrity Check und Bot-Schutz ausnimmt, gilt auch hier.

**Ablauf**

| Vom Ladepunkt | Wirkung |
|---|---|
| `BootNotification` | angenommen, Heartbeat alle 300 s; leere Felder Hersteller/Modell werden ausgefüllt |
| `Heartbeat` | Lebenszeichen |
| `StatusNotification` | `Available` frei, `Charging`/`SuspendedEV`/`SuspendedEVSE` lädt, `Finishing` fertig, `Unavailable`/`Faulted` Störung; `Preparing` und `Reserved` ändern nichts. Connector 0 gestört: alle Ausgänge gestört |
| `Authorize`, `StartTransaction` | nur idTags, die mit `PDR` beginnen (von uns beim Fernstart vergeben), sind gültig; Ladekarten gibt es noch nicht. Jeder Start bekommt eine `transactionId` (Zeile in `ocpp_transactions`) |
| `MeterValues` | Leistung (`Power.Active.Import`, W oder kW) und Energie der Ladung (Zählerstand minus `meterStart`) |
| `StopTransaction` | Ladung beendet, Energie gespeichert, Ausgang fertig |
| `DataTransfer` | `UnknownVendorId` |
| alles andere | `NotImplemented` |

„Allumer“ schickt `RemoteStartTransaction` mit einem neuen idTag, „Éteindre“ `RemoteStopTransaction` mit der offenen `transactionId` des Connectors (ohne laufende Ladung: Fehlermeldung). Die Antwort des Ladepunkts (`Accepted`/`Rejected` oder ein CALLERROR) schließt den Befehl in `device_commands`. Ist der Ladepunkt nicht verbunden, zeigt das Backoffice „hors ligne“. Trennt er die Verbindung, gelten seine Ausgänge sofort als offline. Eine feste Ladedauer gibt es über OCPP 1.6 nicht.

## Xingke-Protokoll V1.1 (über eine Brücke)

Das ältere Textprotokoll bleibt für Geräte ohne Xingke-Cloud.

Die Doppelsteckdose von Alibaba spricht das "Xingke 16-Port-Protokoll V1.1": Textzeilen wie `MOD:52;EID:123456;PORT:0000|0101;\r\n`. Wie die Zeilen übertragen werden (TCP, MQTT oder HTTP) sagt das Dokument nicht; das ist beim Hersteller offen. Ein Cloudflare Worker kann keinen TCP-Server betreiben, deshalb braucht es dafür eine kleine Brücke (Hersteller-Cloud oder eigener Server), die zwei Dinge tut:

1. Jede Zeile vom Gerät unverändert weiterreichen: `POST /api/devices/events?format=xingke`, Header `X-Device-Key`, Body als Text. Mehrere Zeilen in einem Body sind erlaubt.
2. Alle paar Sekunden Befehle abholen und an das Gerät schreiben: `GET /api/devices/commands` (optional `?device=123456`), gleicher Header. Die Antwort ist Text, eine Zeile pro Befehl, leer wenn nichts ansteht. Jeder Befehl wird nur einmal ausgegeben; einer, der nach 2 Minuten nicht abgeholt wurde, verfällt, damit ein Ausgang nie verspätet einschaltet.

Gerät anlegen wie oben, mit der 6-stelligen Gerätenummer als `externalId` und `"link":"vendor_cloud"` (oder `own_server`). Kanal `00` ist Ausgang 1, Kanal `01` Ausgang 2.

Was der Worker aus den Meldungen macht:

| `MOD` | Meldung | Wirkung |
|---|---|---|
| `52` | Gerätestatus, alle 15 min | `PORT`: `00` frei, `01` lädt, `90`/`91`/`99` Störung. Trennzeichen `\|` oder `,` |
| `51` | Auftragsstatus | `MSG 00` lädt (mit Leistung `P` und Energie `E`), `03` fertig, `08` Störung, sonst frei |
| `70` | Störung | mit Kanal: dieser Ausgang gestört; ohne Kanal: alle Ausgänge gestört bis zur nächsten Statusmeldung |
| `01` / `02` | Antwort auf Ein/Aus | schließt den Befehl (`done` oder `failed`, `MSG` in `result`); Ein erfolgreich = lädt, Aus erfolgreich = frei |
| `53`, `90`, `91`, `99` | Karte, Parameter, Neustart | nur Lebenszeichen |

Ausgang schalten: im Backoffice unter **Prises connectées** mit „Allumer“ (bis voll) und „Éteindre“, oder per API:

```bash
# ein, bis voll (oder mit {"minutes":60} für 60 Minuten)
curl -X POST https://app.poinderecharge.com/api/admin/devices/123456/outlets/1/start -H "Authorization: Bearer <admin-token>"
# aus (beendet den zuletzt gestarteten Auftrag dieses Ausgangs)
curl -X POST https://app.poinderecharge.com/api/admin/devices/123456/outlets/1/stop -H "Authorization: Bearer <admin-token>"
```

Offene Punkte stehen am Ende der Übersetzung: Übertragungsweg, Anmeldung des Geräts, Kanalzählung, Format der Auftragsnummer. Die Annahmen oben (Kanal ab `00`, Auftragsnummer aus 20 Ziffern) werden angepasst, sobald der Hersteller antwortet.

## Testen ohne Hardware

```bash
curl -X POST "https://app.poinderecharge.com/api/devices/events" \
  -H "X-Device-Key: $DEVICE_WEBHOOK_SECRET" \
  -d '{"device":"A84041000181F0A1","outlets":[{"outlet":1,"status":"charging","power_watts":180}]}'
```

Xingke-Zeile:

```bash
curl -X POST "https://app.poinderecharge.com/api/devices/events?format=xingke" \
  -H "X-Device-Key: $DEVICE_WEBHOOK_SECRET" -H "Content-Type: text/plain" \
  --data-binary $'MOD:52;EID:123456;T:2601;V:22035;PORT:0000|0101;VER:2122;\r\n'
```

Im Demo-Modus der App zeigt die Station "Déckon (prises connectées)" eine solche Steckdose mit Beispieldaten.
