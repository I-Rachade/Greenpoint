// Opens pages like an entry-level Android phone on a slow mobile network and prints how long
// they take to show something (FCP) and their main content (LCP), and how much JavaScript came.
//   node scripts/slow-phone.mjs https://app.poinderecharge.com/ https://app.poinderecharge.com/carte
// Phone: CPU 4x slower than this computer, 360x740 screen. Network: "Slow 4G" (150 ms, 1.6 Mbit/s).
// Each page is opened 3 times with an empty cache; the median is printed. Phone language: LOCALE (fr-FR).
// Playwright is not a dependency of the project: set PLAYWRIGHT_MODULE to where it is installed if needed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error("Usage: node scripts/slow-phone.mjs <url> [url…]");
  process.exit(1);
}

const RUNS = 3;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function measure(browser, url) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: process.env.LOCALE ?? "fr-FR" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  let js = 0;
  cdp.on("Network.loadingFinished", (e) => (js += e.encodedDataLength));
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => ({
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
    lcp: window.__lcp,
  }));
  await context.close();
  return { ...result, kb: js / 1024 };
}

const browser = await chromium.launch();
for (const url of urls) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, url));
  const fcp = median(runs.map((r) => r.fcp));
  const lcp = median(runs.map((r) => r.lcp));
  const kb = median(runs.map((r) => r.kb));
  console.log(`${url}  FCP ${(fcp / 1000).toFixed(2)} s  LCP ${(lcp / 1000).toFixed(2)} s  transferred ${kb.toFixed(0)} KB`);
}
await browser.close();
