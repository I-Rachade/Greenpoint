// Phone screenshots for the store listings, taken from the demo build so no real
// accounts or numbers appear. Google Play: 1080 x 1920 (9:16). App Store (`ios`):
// 1320 x 2868, the 6.9" iPhone size Apple requires.
//
//   npm run build && npx serve out -l 4173   (or any static server on out/)
//   node scripts/store-screenshots.mjs http://localhost:4173 store-assets fr [ios]
//
// The Store screenshots workflow runs this and publishes the images to the
// `play-store-assets` and `app-store-assets` releases.

const [base = "http://localhost:4173", outDir = "store-assets", lang = "fr", device = "android"] = process.argv.slice(2);
const SCREEN =
  device === "ios"
    ? { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 }
    : { viewport: { width: 400, height: 711 }, deviceScaleFactor: 2.7 };
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { mkdirSync } = await import("node:fs");
mkdirSync(outDir, { recursive: true });

// Software WebGL so the map renders on machines without a GPU (CI).
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({
  ...SCREEN,
  // Central Lomé, near the demo stations.
  geolocation: { latitude: 6.1319, longitude: 1.2228 },
  permissions: ["geolocation"],
  locale: lang === "en" ? "en-US" : "fr-FR",
});
const page = await context.newPage();
const fr = lang !== "en";
const T = {
  reserve: fr ? "Réserver une batterie" : "Reserve a battery",
  register: fr ? "Inscription" : "Sign up",
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
  await page.evaluate((l) => {
    localStorage.setItem("poinderecharge-locale", l);
    // Skip the first-launch introduction and the web splash screen.
    localStorage.setItem("poinderecharge-onboarded", "1");
    sessionStorage.setItem("poinderecharge-splash", "1");
  }, lang);
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
await open("/login.html");
await page.getByRole("tab", { name: T.register }).click();
await page.getByPlaceholder("90 12 34 56").fill("90 12 34 56");
// Sign-up needs the terms and privacy policy accepted before the code is sent.
await page.getByRole("checkbox").check();
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
await open("/reservations.html");
await shot("5-code");

await browser.close();
