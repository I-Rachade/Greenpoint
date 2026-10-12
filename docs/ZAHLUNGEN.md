# Zahlungen mit Flooz und T-Money

Stand: vorbereitet, **nicht live**. Ohne Zugangsdaten des Zahlungsanbieters läuft alles gegen einen simulierten Anbieter; niemand wird belastet. Die Oberfläche in der App (Bezahlen-Knopf) fehlt noch.

Anbietervergleich und was dafür zu beantragen ist: `planung/zahlungsanbieter.md` im Projektordner.

## Ablauf

```
App ──(1) POST /api/payments──► Worker ──(2)──► PayGate Global ──(3) Bestätigung──► Handy des Fahrers
 ▲                                │                    │
 │                                ▼                    │ (4) Rückruf
 └──(6) /api/payments/:id/refresh  D1 payments ◄─(5)── POST /api/payments/callback?key=…
```

1. Die App ruft `POST /api/payments` mit `{ reservationId, network: "flooz" | "tmoney", phone }` auf (angemeldet).
2. Der Worker legt eine Zahlung `pending` an. **Der Betrag kommt aus der Station** (`price_battery_xof` bzw. `price_slot_xof`), nie aus der App. Danach fordert er die Zahlung beim Anbieter an.
3. Der Fahrer bestätigt auf dem Handy mit seinem Flooz- bzw. T-Money-PIN.
4. Der Anbieter ruft `POST /api/payments/callback?key=<PAYMENT_CALLBACK_SECRET>` auf.
5. Der Worker **glaubt dem Inhalt des Rückrufs nicht**, sondern fragt den Status selbst beim Anbieter ab. Nur `pending`-Zahlungen ändern sich; ein doppelter oder später Rückruf kann eine erfolgreiche Zahlung nicht mehr umwerfen.
6. Die App fragt mit `POST /api/payments/:id/refresh` nach, bis die Zahlung nicht mehr `pending` ist. `GET /api/payments/mine` listet die eigenen Zahlungen.

## Regeln im Code

- Nur **eigene Stationen** (`operators.is_own`) nehmen Zahlungen an. Geld für fremde Betreiber einzusammeln kann nach BCEAO-Instruktion 001-01-2024 ein Zahlungsdienst sein (siehe `planung/rechtliches-togo.md`). Das wird erst freigeschaltet, wenn der Anbieter Split-Payment anbietet und ein Anwalt zugestimmt hat.
- Höchstens eine offene oder erfolgreiche Zahlung pro Reservierung (eindeutiger Index, gilt auch bei gleichzeitigen Anfragen). Nach einer abgelehnten Zahlung darf der Fahrer es erneut versuchen.
- Preise in FCFA, ganze Zahl, Vielfaches von 5. Ohne Preis wird für die Station nichts verlangt.
- Löscht ein Fahrer sein Konto, bleiben seine Zahlungen für die Buchhaltung erhalten, aber ohne Nutzer und ohne Mobile-Money-Nummer (Trigger in der Migration).
- Fahrer sehen nur ihre eigenen Zahlungen. Jede Zahlung und jeder Statuswechsel landet im Aktivitätsprotokoll.
- Netz-Vorauswahl nach Vorwahl (`detectNetwork`): Togocom/T-Money 70–73, 90–93; Moov/Flooz 78, 79, 96–99. Nur ein Vorschlag, der Fahrer kann wechseln.

## Dateien

| Datei | Inhalt |
|---|---|
| `worker/migrations/0003_payments.sql` | Tabelle `payments`, Preise an `stations` |
| `worker/payment-providers.ts` | Anbieter (PayGate Global, Simulation), ohne Abhängigkeiten |
| `worker/payments.ts` | Routen: Zahlung starten, nachfragen, eigene Zahlungen, Rückruf |
| `worker/payments.test.ts` | Tests, laufen auf SQLite mit den echten Migrationen |

Ein weiterer Anbieter (z. B. Semoa oder CinetPay) ist eine weitere Umsetzung von `PaymentProvider` in `payment-providers.ts`; Datenbank und App bleiben gleich.

## Einrichten (wenn das Händlerkonto steht)

1. Migration ausführen: `npm run db:migrate`.
2. Im Worker unter **Settings > Variables and secrets** das Secret `PAYMENT_CALLBACK_SECRET` (langer Zufallswert) anlegen.
3. Im PayGate-Dashboard als Rückruf-URL eintragen:
   `https://app.poinderecharge.com/api/payments/callback?key=<PAYMENT_CALLBACK_SECRET>`
4. Feldnamen in `paygateProvider()` mit dem Integrationsleitfaden im PayGate-Dashboard abgleichen (er ist erst nach der Freischaltung sichtbar).
5. Preise an den eigenen Stationen setzen, in der D1-Konsole zum Beispiel:
   `update stations set price_battery_xof = 500 where id = '…';`
6. Erst dann echte Zahlungen einschalten, mit einem kleinen Betrag auf einer eigenen Nummer: `PAYMENTS_PROVIDER` = `paygate` (Text) und `PAYGATE_AUTH_TOKEN` = API-Schlüssel (Secret). Fehlt einer der beiden Werte oder ist er falsch geschrieben, bleibt die Simulation aktiv.

Den API-Schlüssel nie in die App, ins Repo oder in den Chat.

## Simulation

Ohne `PAYMENTS_PROVIDER=paygate` und Token:
- Nummer endet auf **0**: der Anbieter lehnt ab, Zahlung `failed`.
- Jede andere Nummer: Zahlung `pending`, beim ersten Nachfragen `succeeded`.

## Offen

- Bezahlen-Knopf in der App (Reservierung, Statusanzeige, Wechsel Flooz/T-Money) und Preisfelder im Stationsformular.
- Wann bezahlt wird: beim Reservieren oder an der Station. Erstattung bei Stornierung oder geschlossener Station.
- Beleg nach togoischem Verbraucherrecht (Art. 25) und Aufbewahrung 5 Jahre (siehe `planung/rechtliches-togo.md`).
