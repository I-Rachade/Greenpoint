# Zahlungen mit Flooz und T-Money

Stand: vorbereitet, **nicht live**. Ohne Zugangsdaten des Zahlungsanbieters läuft alles gegen einen simulierten Anbieter; niemand wird belastet (nur Admins sehen die Option zum Testen).

Flooz/T-Money bezahlt nur **beendete Ladungen an unseren Steckdosen** (Motorrad und Autoladesäulen an einer verbundenen Steckdose). **Reservierungen und Green Credit werden nicht mit Flooz/T-Money bezahlt** (Oktober 2026): Green Credit wird nur bar am Schalter mit dem QR-Code geladen. Eine früher gestartete Reservierungszahlung wird über den Rückruf noch abgeschlossen.

Anbietervergleich und was dafür zu beantragen ist: `planung/zahlungsanbieter.md` im Projektordner.

## Ablauf

```
App ──(1) POST /api/charging/:id/pay/mobile──► Worker ──(2)──► PayGate Global ──(3) Bestätigung──► Handy des Kunden
 ▲                                │                    │
 │                                ▼                    │ (4) Rückruf
 └──(6) /api/payments/:id/refresh  D1 payments ◄─(5)── POST /api/payments/callback?key=…
```

1. Die App ruft `POST /api/charging/:id/pay/mobile` mit `{ network: "flooz" | "tmoney", phone }` für eine beendete Ladung auf (angemeldet).
2. Der Worker legt eine Zahlung `pending` an. **Der Betrag kommt aus der Ladung** (Energie × Preis der Station, mindestens der Mindestpreis), nie aus der App. Danach fordert er die Zahlung beim Anbieter an.
3. Der Kunde bestätigt auf dem Handy mit seinem Flooz- bzw. T-Money-PIN.
4. Der Anbieter ruft `POST /api/payments/callback?key=<PAYMENT_CALLBACK_SECRET>` auf.
5. Der Worker **glaubt dem Inhalt des Rückrufs nicht**, sondern fragt den Status selbst beim Anbieter ab. Nur `pending`-Zahlungen ändern sich; ein doppelter oder später Rückruf kann eine erfolgreiche Zahlung nicht mehr umwerfen.
6. Die App fragt mit `POST /api/payments/:id/refresh` nach, bis die Zahlung nicht mehr `pending` ist. `GET /api/payments/mine` listet die eigenen Zahlungen.

## Regeln im Code

- Nur **eigene Stationen** (`operators.is_own`) nehmen Zahlungen an. Geld für fremde Betreiber einzusammeln kann nach BCEAO-Instruktion 001-01-2024 ein Zahlungsdienst sein (siehe `planung/rechtliches-togo.md`). Das wird erst freigeschaltet, wenn der Anbieter Split-Payment anbietet und ein Anwalt zugestimmt hat.
- Höchstens eine offene oder erfolgreiche Zahlung pro Ladung (eindeutiger Index, gilt auch bei gleichzeitigen Anfragen). Nach einer abgelehnten Zahlung darf der Kunde es erneut versuchen.
- Preise in FCFA, ganze Zahl, Vielfaches von 5. Ohne Preis wird für die Station nichts verlangt.
- Löscht ein Kunde sein Konto, bleiben seine Zahlungen für die Buchhaltung erhalten, aber ohne Nutzer und ohne Mobile-Money-Nummer (Trigger in der Migration).
- Kunden sehen nur ihre eigenen Zahlungen. Jede Zahlung und jeder Statuswechsel landet im Aktivitätsprotokoll.
- Netz-Vorauswahl nach Vorwahl (`detectNetwork`): Togocom/T-Money 70–73, 90–93; Moov/Flooz 78, 79, 96–99. Nur ein Vorschlag, der Kunde kann wechseln.

## Dateien

| Datei | Inhalt |
|---|---|
| `worker/migrations/0006_payments.sql` | Tabelle `payments`, Preise an `stations` |
| `worker/payment-providers.ts` | Anbieter (PayGate Global, Simulation), ohne Abhängigkeiten |
| `worker/payments.ts` | Zahlung einer Ladung anlegen, nachfragen, eigene Zahlungen, Rückruf |
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

## Portefeuille aufladen (Flooz, T-Money, Bankkarte)

Im Portefeuille gibt es den Reiter „Recharger“ (`worker/wallet-topups.ts`, Tabelle `wallet_topups`, Migration `0010_wallet_topups.sql`).

- **Flooz / T-Money:** wie oben über PayGate, die Anfrage geht aufs Handy. Kennung `pdw_…`, derselbe Rückruf `/api/payments/callback`.
- **Bankkarte (Visa, Mastercard):** über CinetPay. Der Worker legt eine Zahlung an und gibt die Bezahlseite von CinetPay zurück; die App öffnet sie, CinetPay schickt die Person zurück auf `/portefeuille?topup=<id>` und meldet das Ergebnis an `/api/payments/callback` (Feld `cpm_trans_id`). Beträge müssen Vielfache von 5 sein.
- Gutgeschrieben wird erst, wenn der Anbieter selbst den Erfolg bestätigt, und genau einmal: Statuswechsel und Gutschrift sind ein Batch.
- Ohne echte Zugangsdaten läuft die Simulation, die jede Zahlung bestätigt. Damit niemand Geld aus dem Nichts bekommt, sehen Kunden dann „arrive bientôt“; nur Admins können testen.

Einschalten (Worker > Settings > Variables and secrets):

| Name | Typ | Inhalt |
|---|---|---|
| `PAYMENTS_PROVIDER` | Text | `paygate` (Flooz/T-Money) |
| `PAYGATE_AUTH_TOKEN` | Secret | API-Schlüssel von PayGate |
| `CARD_PROVIDER` | Text | `cinetpay` (Bankkarte) |
| `CINETPAY_API_KEY` | Secret | API-Schlüssel von CinetPay |
| `CINETPAY_SITE_ID` | Text | Site-ID von CinetPay |
| `PAYMENT_CALLBACK_SECRET` | Secret | langer Zufallswert, auch für den Rückruf von CinetPay |

Bei CinetPay den Kartenkanal freischalten lassen und die Feldnamen in `cinetpayProvider()` mit der Doku im Händler-Dashboard abgleichen. Die Kartengebühr von CinetPay trägt derzeit poinderecharge: gutgeschrieben wird der volle Betrag.
