# Partner-API

Andere Apps (Online-Shops, Lieferdienste) buchen über eine REST-API einen Pakettransport zwischen zwei Stationen und bekommen jede Statusänderung, die auch die App zeigt. Abgerechnet wird über das Partnerkonto, am Schalter zahlt niemand.

- Doku für Entwickler (Französisch): `https://app.poinderecharge.com/developpeurs`
- Technische Referenz: `https://app.poinderecharge.com/partner-api/openapi.json` (OpenAPI 3.1, lässt sich in Postman importieren)
- Basis-Adresse: `https://app.poinderecharge.com/api/partner/v1`
- Code: `worker/partners.ts`, `shared/partners.ts`, Migration `worker/migrations/0008_partner_api.sql`, Tests `worker/partners.test.ts`

## Einen Partner freischalten

1. Backoffice → **Partenaires API** → „Nouveau partenaire“: Name, Telefon (gilt als Absender, wenn die Buchung keinen nennt), E-Mail, optional Webhook-Adresse.
2. „Créer une clé“: Der Schlüssel `pdr_live_…` erscheint **nur einmal**. Kopieren und dem Partner sicher schicken (nicht per offener Gruppe). In der Datenbank liegt nur sein SHA-256.
3. Dem Partner den Link zur Doku schicken. Den Webhook kann er selbst per API setzen.
4. Schlüssel geleakt: „Révoquer“ sperrt ihn sofort, dann einen neuen erstellen. Partner abschalten: „Modifier“ → „Actif“ aus.

„Envoyer le code de retrait au partenaire“ ist aus. Eingeschaltet bekommt der Partner bei `arrived` den 6-stelligen Abholcode, damit er ihn seinem Kunden weitergeben kann. Er könnte das Paket dann aber auch selbst abholen.

## Ablauf

| Schritt | Wer | Was passiert |
|---|---|---|
| Buchen | Partner-App | `POST /bookings` mit Start- und Zielstation, Empfänger, Inhalt, Maßen. Antwort: Sendungsnummer `GP-…` und Preis. Status `booked` |
| Abgabe | Kunde und Personal in Station A | Unter „Colis“ → „Annoncés par des partenaires“ steht das Paket. Personal misst, wiegt, prüft den Inhalt, „Réceptionner“. Ab jetzt ist es ein normales Paket mit derselben Nummer (`deposited`). Ist es größer als gebucht, gelten Größe und Preis vom Schalter |
| Transport, Ankunft, Abholung | wie beim Paket-Depot | `in_transit` → `arrived` (Empfänger bekommt Code in der App) → `picked_up`; nach 7 Tagen `stored` |
| Nicht abgegeben | | Nach 7 Tagen `expired`. Der Partner kann vorher selbst stornieren (`cancelled`) |

Jede Änderung geht als Webhook an den Partner (`booking.created`, `parcel.deposited`, `parcel.in_transit`, `parcel.arrived`, `parcel.picked_up`, `parcel.stored` …). Die Nachrichten werden aus `parcel_events` erzeugt: alles, was dort einen Status schreibt (Personal, täglicher Job, später die Fahrer), erreicht den Partner ohne Änderung an der API.

## Webhooks

- POST mit JSON an die https-Adresse des Partners, Header `Poinderecharge-Signature: t=<unix>,v1=<hex>`: HMAC-SHA256 mit dem Secret `whsec_…` über `t.Body`. Beispiele zur Prüfung (Node, PHP) stehen auf der Doku-Seite.
- Antwortet der Partner nicht mit 2xx, wird nach 1, 5, 30 Minuten, 2, 6, 12 und 24 Stunden erneut gesendet, dann aufgegeben. Im Backoffice unter „Derniers webhooks“ sieht man jede Nachricht und kann sie „Renvoyer“.
- Gesendet wird direkt nach der Änderung und zusätzlich jede Minute per Cron (`* * * * *` in `wrangler.jsonc`) für Wiederholungen.
- Ohne Webhook holt der Partner dieselben Nachrichten mit `GET /events?after=<letzte id>`.

## Abrechnung

Partnerpakete haben `payment_method = 'partner'` und `partner_id`. Im Backoffice zeigt jede Partnerkarte Pakete und Summe der letzten 30 Tage. Rechnungen schreibt man vorerst von Hand aus diesen Zahlen (SQL: `select * from parcels where partner_id = ? and created_at >= ?`).

## Einführen

1. Migration ausführen: `npm run db:migrate` (legt nur Tabellen und Spalten an, sicher vor dem Deploy).
2. Worker deployen. Der Minuten-Cron wird damit aktiv.
3. Testpartner im Backoffice anlegen, Schlüssel erstellen, mit der Doku eine Buchung machen und an der Station annehmen.

## Noch nicht drin

- Abholung beim Kunden und Lieferung nach Hause durch Fahrer (Plan: `planung/fahrer.md`). Sobald die Fahrer-Phase 1 läuft, bekommen Buchungen ein Feld dafür. Neue Status kommen automatisch als Webhook an, Partner sind angewiesen, unbekannte Status zu ignorieren.
- Eine Testumgebung (Sandbox) mit eigenen Schlüsseln.
- Automatische Monatsrechnung.
