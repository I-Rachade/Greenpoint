# Verbundene Steckdosen (LoRa)

poinderecharge kann den Status von vernetzten Ladesteckdosen live anzeigen, z. B. LoRa-Doppelsteckdosen zum Selbstladen von E-Scootern. Jeder Ausgang ist ein Ladeplatz (`charging_points`). Die Steckdose meldet, ob ein Ausgang frei ist, lädt, fertig ist oder gestört ist; die App zeigt das sofort auf der Stationsseite und zählt die freien Plätze automatisch.

Steckdosen mit dem Xingke-Protokoll (Hersteller der Alibaba-Doppelsteckdose) lassen sich außerdem fernschalten: ein Admin schaltet einen Ausgang ein oder aus (siehe [Xingke](#xingke-protokoll)). Abrechnung pro Ladevorgang kommt in Phase 2 mit der Bezahlung. Hintergrund: `planung/lora-ladesteckdose.md`, Protokoll auf Englisch: `planung/xingke-16-port-protocol-v1.1-en.md` im Projektordner.

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
- `src/lib/iot/xingke-commands.ts`: baut die Xingke-Befehle (Ausgang ein/aus).

## Einrichten

1. Migration einspielen: `npx wrangler d1 migrations apply DB --remote`.
2. Schlüssel setzen: im Cloudflare-Dashboard unter **Workers > pointderecharge-app > Settings > Variables and secrets** ein Secret `DEVICE_WEBHOOK_SECRET` mit einem langen zufälligen Wert anlegen. Ohne Schlüssel lehnt der Worker alle Meldungen ab (503).
3. Gerät anlegen (als Admin angemeldet, Token aus dem Login). Das legt pro Ausgang einen Ladeplatz an, bezeichnet `<letzte 4 Zeichen>-<Ausgang>`:
   ```bash
   curl -X POST https://app.poinderecharge.com/api/admin/devices \
     -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" \
     -d '{"externalId":"A84041000181F0A1","stationId":"<station-id>","vendor":"Hersteller","model":"Modell","link":"lorawan","outlets":2}'
   ```
   Danach die Bezeichnungen der Ladeplätze an die Aufkleber neben dem QR-Code anpassen (D1-Konsole: `update charging_points set label = 'A1' where device_id = '…' and outlet = 1;`) und `charging_slots` der Station auf die Anzahl der Ausgänge setzen.
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

## Xingke-Protokoll

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

Ausgang schalten (als Admin):

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
