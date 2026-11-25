# Schutz von Login und API gegen Missbrauch

Stand 26.10.2026. Code: `worker/security.ts`, `worker/security-log.ts`, `worker/ip-limits.ts`, `worker/auth.ts`, `worker/code-tries.ts`.

## Was wovor schützt

| Schutz | Wie | Wo |
| --- | --- | --- |
| PIN-Sperre | 5 falsche PINs in Folge sperren das Konto 15 Minuten, jede weitere Sperre doppelt so lange (höchstens 24 h). Zahlungs-PIN zählt mit. | `auth.ts` |
| Warnung an den Kontoinhaber | Bei jeder Sperre: Push-Mitteilung und E-Mail (falls Adresse), Französisch, mit Hinweis auf „Code PIN oublié ?". Keine SMS (Kosten). | `auth.ts` warnPinLocked |
| Roboter-Prüfung beim PIN-Login | Nach 3 fehlgeschlagenen Logins in 15 Minuten für eine Nummer/Adresse **oder** von einer IP verlangt der Login Turnstile (`captcha_required`). Gleiche Antwort für bekannte und unbekannte Nummern. | `security.ts` guardedSignIn |
| Alarm | Mehr als 200 fehlgeschlagene Logins in 15 Minuten in der ganzen App: eine Stunde lang verlangt **jeder** Login Turnstile (gegen „eine PIN auf vielen Nummern"). | `security.ts` alarmOn |
| Limits pro IP auf den Login-Routen | 10 Code-Anfragen pro Stunde, 60 PIN-Logins und Registrierungen pro 15 Minuten. | `ip-limits.ts` |
| Limits für die ganze API | pro IP 300 Anfragen/Minute; pro Kundenkonto 120/Minute und höchstens 30 Änderungen (alles außer GET)/Minute; Personal, Fahrer und andere Arbeitsrollen 600/Minute ohne eigenes Änderungslimit. | `security.ts`, `wrangler.jsonc` `ratelimits` |
| Partner-API | 60 Anfragen/Minute pro Partner (alle Schlüssel zusammen), Antwort 429 mit `Retry-After`. | `partners.ts` |
| Codes am Schalter, Pakete, Abholung | begrenzte falsche Versuche pro Mitarbeiter, Paket oder Station. | `code-tries.ts` |

Jede Sperre und jedes Limit antwortet mit `429`, dem Header `Retry-After` (Sekunden) und `retryAfter` im JSON. Die App zeigt daraus „Réessayez dans N min".

Die API-Limits zählt Cloudflare pro Standort; es kann also etwas mehr durchgehen. Gegen Roboter reicht das, die Werte sind großzügig, weil sich in Togo viele Telefone eine IP des Netzbetreibers teilen. Ändern: Zahlen in `wrangler.jsonc` (`ratelimits`), Zeitraum nur 10 oder 60 Sekunden.

## Sicherheitsprotokoll und Backoffice

Tabelle `security_events` (Migration `0062_security_events.sql`): fehlgeschlagene Logins (Nummer/Adresse nur maskiert, z. B. `+22890****01`, dazu ein Hash zum Zählen), Sperren, abgelehnte Anfragen (höchstens ein Eintrag pro IP/Konto und Minute), fehlgeschlagene Roboter-Prüfungen, Alarm, Entsperrungen. Einträge älter als 30 Tage löscht der tägliche Cron.

Backoffice → **Clients → Sécurité**: gesperrte Konten mit Knopf **Débloquer** (nur Admins), Zahlen der letzten 24 Stunden, aktivste IP-Adressen, das Protokoll. Ein gelber Hinweis erscheint, solange Turnstile nicht eingerichtet ist.

## Einrichtung (einmal)

1. **Migration:** `npm run db:migrate` (legt nur die Tabelle an, sicher vor dem Deploy).
2. **Deploy** des Workers `pointderecharge-app`: die Limits stehen in `wrangler.jsonc` und kommen mit dem Deploy.
3. **Turnstile einschalten** (ohne Turnstile gibt es die Roboter-Prüfung nicht, alles andere gilt trotzdem):
   1. Cloudflare-Dashboard → **Turnstile** → **Add widget**.
   2. Name `poinderecharge`, Hostnames `app.poinderecharge.com`, `admin.poinderecharge.com` und `localhost` (Android- und iOS-App), Modus **Managed**.
   3. Beim Worker `pointderecharge-app` → **Settings → Variables and Secrets**: `TURNSTILE_SITE_KEY` (Text) = Site Key, `TURNSTILE_SECRET` (Secret) = Secret Key.
   4. Prüfen: Backoffice → Sécurité zeigt keinen gelben Hinweis mehr; beim Code-Versand erscheint das Widget.
4. **Cloudflare-Regeln vor dem Worker** (Dashboard der Zone `poinderecharge.com`, kein Code):
   1. **Bot Fight Mode nicht einschalten:** er lässt sich im kostenlosen Plan für einzelne Pfade nicht abschalten und kann Server ohne Browser blockieren, die wir brauchen (Zahlungsanbieter-Rückrufe, Xingke-Cloud, OCPP-Ladesäulen, Partner-Apps).
   2. **Security → WAF → Rate limiting rules → Create rule**: Name „API flood", Ausdruck *URI Path starts with `/api/`*, Kennzeichen *IP*, **600 Anfragen pro 1 Minute**, Aktion **Block** für 1 Minute. (Im kostenlosen Plan ist eine solche Regel enthalten.) Ausnahme nicht nötig: die Geräte (`/api/devices/…`) senden weit weniger.

## Werte ändern

| Was | Wo |
| --- | --- |
| Versuche bis zur Roboter-Prüfung, Alarmschwelle | `worker/security.ts` (`LOGIN_CAPTCHA_AFTER`, `LOGIN_ALARM_FAILURES`) |
| PIN-Sperre | `worker/auth.ts` (`PIN_MAX_FAILURES`, `PIN_LOCK_MINUTES`) |
| Limits pro IP auf den Login-Routen | `worker/ip-limits.ts` (`IP_LIMITS`) |
| API- und Partner-Limits | `wrangler.jsonc` (`ratelimits`) |
