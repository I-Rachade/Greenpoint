# Verbundene Steckdosen (LoRa)

Greenpoint kann den Status von vernetzten Ladesteckdosen live anzeigen, z. B. LoRa-Doppelsteckdosen zum Selbstladen von E-Scootern. Jeder Ausgang ist ein Ladeplatz (`charging_points`). Die Steckdose meldet, ob ein Ausgang frei ist, lädt, fertig ist oder gestört ist; die App zeigt das sofort auf der Stationsseite und zählt die freien Plätze automatisch.

Fernsteuerung (Ausgang ein/aus) und Abrechnung pro Ladevorgang kommen in Phase 2 mit der Bezahlung, sobald die API des Herstellers bekannt ist. Hintergrund und Fragen an den Hersteller: `planung/lora-ladesteckdose.md` im Projektordner.

## Aufbau

```
Steckdose --LoRa--> Gateway --4G--> Netzwerkserver (TTN / ChirpStack)
                                    oder Hersteller-Cloud
                                          |
                                          v  HTTPS + Schlüssel
                     Supabase Edge Function "device-events"
                                          |
                                          v
                     ingest_device_event()  ->  charging_points, station_status
                                          |
                                          v  Realtime
                                        App
```

- `supabase/migrations/20261012000200_devices.sql`: Tabellen `devices` und `device_messages`, Funktion `ingest_device_event`.
- `supabase/functions/device-events/`: Edge Function, nimmt Meldungen an.
- `supabase/functions/_shared/device-events.ts`: liest die Formate (wird auch in den Tests geprüft).
- `src/lib/iot/charging-points.ts`: "offline", wenn ein Gerät 15 Minuten nichts meldet.

## Einrichten

1. Migration einspielen (`supabase db push`).
2. Funktion veröffentlichen und Schlüssel setzen:
   ```bash
   supabase functions deploy device-events --no-verify-jwt
   supabase secrets set DEVICE_WEBHOOK_SECRET=<langer zufälliger Wert>
   ```
   `--no-verify-jwt`, weil der Netzwerkserver kein Supabase-Login hat; geschützt ist die Funktion über den Schlüssel.
3. Gerät anlegen (Supabase SQL-Editor). Das legt pro Ausgang automatisch einen Ladeplatz an:
   ```sql
   insert into devices (external_id, station_id, vendor, model, link, outlets)
   values ('A84041000181F0A1', '<station-id>', 'Hersteller', 'Modell', 'lorawan', 2);
   ```
   Danach die Bezeichnungen der Ladeplätze an die Aufkleber neben dem QR-Code anpassen und `charging_slots` der Station auf die Anzahl der Ausgänge setzen.
4. Netzwerkserver oder Hersteller-Cloud auf die Funktion zeigen lassen:
   - URL: `https://<projekt>.supabase.co/functions/v1/device-events?format=ttn` (oder `chirpstack`, `generic`)
   - Header: `X-Greenpoint-Key: <DEVICE_WEBHOOK_SECRET>`

## Formate

Alle Formate liefern am Ende dieselbe Liste `outlets`:

```json
{ "outlets": [ { "outlet": 1, "status": "charging", "power_watts": 180, "energy_wh": 420 },
               { "outlet": 2, "status": "free" } ] }
```

- `status`: `free`, `charging`, `done`, `fault` (auch `idle`, `on`, `full`, `error` u. ä. werden verstanden). Fehlt er, entscheidet die Leistung: über 5 W = lädt.
- Ohne `outlets` gilt die Meldung als Lebenszeichen.
- Ein reservierter Ausgang bleibt reserviert, auch wenn das Gerät "frei" meldet.

| `format` | Gerätekennung | Ausgänge |
|---|---|---|
| `generic` | `device` | `outlets` |
| `ttn` | `end_device_ids.dev_eui` | `uplink_message.decoded_payload.outlets` |
| `chirpstack` | `deviceInfo.devEui` | `object.outlets` |

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

## Testen ohne Hardware

```bash
curl -X POST "https://<projekt>.supabase.co/functions/v1/device-events" \
  -H "X-Greenpoint-Key: $DEVICE_WEBHOOK_SECRET" \
  -d '{"device":"A84041000181F0A1","outlets":[{"outlet":1,"status":"charging","power_watts":180}]}'
```

Im Demo-Modus der App zeigt die Station "Greenpoint Déckon (prises connectées)" eine solche Steckdose mit Beispieldaten.
