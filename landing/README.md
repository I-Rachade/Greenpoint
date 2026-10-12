# pointderecharge Landingpage

Statische Seite (HTML, CSS, JS, ohne Build), die die App erklärt und zu Webapp und App-Stores führt.
Liegt bewusst in einem eigenen Ordner, damit sie die Next.js-Webapp nicht berührt.

- Sprachen: Französisch (Standard, direkt in `index.html`) und Englisch (`script.js`). Umschalter oben rechts, `?lang=en` in der Adresse geht auch.
- Links ändern: nur `config.js`. Sobald `android` oder `ios` eine Store-Adresse hat, wird aus "Bientôt sur" ein aktiver Download-Button. `contactEmail` blendet den Kontaktknopf für Stationsbetreiber ein.
- Farben und Schrift folgen `design/tokens.css`, Logos sind Kopien aus `assets/logo/`.

Lokal ansehen: `python3 -m http.server -d landing 8000` und http://localhost:8000 öffnen.
Veröffentlichen: Cloudflare Worker `greenpoint` (Konfiguration in `wrangler.jsonc`) mit den Domains pointderecharge.com und www.pointderecharge.com. Workers Builds: Root directory `landing`, Deploy command `npx wrangler deploy`. Manuell: `cd landing && npx wrangler deploy`. Die Webapp läuft unter https://app.pointderecharge.com.
