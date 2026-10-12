// Phone screenshots for the Google Play listing (1080 x 1920, 9:16), taken from the
// demo build so no real accounts or numbers appear.
//
//   npm run build && npx serve out -l 4173   (or any static server on out/)
//   node scripts/store-screenshots.mjs http://localhost:4173 store-assets fr
//
// The Android workflow runs this and publishes the images to the `play-store-assets` release.

const [base = "http://localhost:4173", outDir = "store-assets", lang = "fr"] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { mkdirSync } = await import("node:fs");
mkdirSync(outDir, { recursive: true });

// Software WebGL so the map renders on machines without a GPU (CI).
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({
  viewport: { width: 400, height: 711 },
  deviceScaleFactor: 2.7,
  // Central Lomé, near the demo stations.
  geolocation: { latitude: 6.1319, longitude: 1.2228 },
  permissions: ["geolocation"],
  locale: lang === "en" ? "en-US" : "fr-FR",
});
const page = await context.newPage();
const fr = lang !== "en";
const T = {
  reserve: fr ? "Réserver une batterie" : "Reserve a battery",
  login: fr ? "Connexion" : "Log in",
  reservations: fr ? "Réservations" : "Reservations",
  register: fr ? "S'inscrire" : "Sign up",
  sendCode: fr ? "Recevoir le code" : "Send code",
  confirm: fr ? "Valider" : "Confirm",
};

/** Store screenshots must not show the demo notice or the promo popup. */
async function tidy() {
  await page.addStyleTag({ content: "header > .bg-amber-100 { display: none !important; }" });
  const close = page.getByRole("dialog").getByRole("button", { name: /fermer|close/i });
  if (await close.count()) await close.first().click().catch(() => {});
  await page.waitForTimeout(400);
}

async function shot(name) {
  await tidy();
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${outDir}/${name}.png`);
}

async function open(path) {
  await page.goto(base + path, { waitUntil: "load" });
  await page.evaluate((l) => localStorage.setItem("poinderecharge-locale", l), lang);
  await page.reload({ waitUntil: "load" });
  // Map tiles and stations.
  await page.waitForTimeout(8000);
}

// 1. Map and the nearest stations.
await open("/");
await shot("1-carte");

// 2. Station details.
await page.getByText("poinderecharge Grand Marché").first().click();
await page.waitForTimeout(1200);
await shot("2-station");

// 3. Sign up: phone number confirmed by SMS code, then a PIN.
await page.getByRole("link", { name: T.login, exact: true }).click();
await page.getByRole("button", { name: T.register }).click();
await page.getByPlaceholder("90 12 34 56").fill("90 12 34 56");
await shot("3-inscription");
await page.getByRole("button", { name: T.sendCode }).click();
await page.waitForTimeout(800);
const inputs = page.locator('input[inputmode="numeric"]');
const values = ["123456", "2580", "2580"];
for (let i = 0; i < (await inputs.count()); i++) {
  const input = inputs.nth(i);
  if (await input.isVisible()) await input.fill(values.shift() ?? "");
}
await page.getByRole("button", { name: T.confirm }).click();
await page.waitForTimeout(2500);

// 4. Reserve a battery.
await open("/");
await page.getByText("poinderecharge Grand Marché").first().click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: T.reserve }).click();
await page.waitForTimeout(1500);
await shot("4-reservation");

// 5. The pickup code to show at the station.
await page.getByRole("link", { name: T.reservations, exact: true }).click();
await page.waitForTimeout(1500);
await shot("5-code");

await browser.close();
