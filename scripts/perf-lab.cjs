// Lab metrics with Lighthouse-like mobile throttling (Slow 4G + 4x CPU), using the repo's Playwright.
const { chromium } = require("@playwright/test");
// address to measure: PERF_BASE=https://… (default: the local test server of npm run test:e2e)
const BASE = process.env.PERF_BASE ?? "http://127.0.0.1:8799";
const OUT = process.env.PERF_OUT ?? require("path").join(__dirname, "..", "test-results", "perf");
const pages = [
  ["home", "/"],
  ["category", "/c/pyjamas"],
  ["product", "/produit/pyjama-short-coton-fleuri"],
  ["cart", "/panier"],
  ["checkout", "/commande"],
  ["home-fr", "/fr"],
];
(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  for (const [name, path] of pages) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 ElFatinaAudit" });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const reqs = [];
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
    page.on("requestfinished", async (r) => {
      const s = await r.sizes().catch(() => null);
      const res = await r.response().catch(() => null);
      reqs.push({ url: r.url().replace(BASE, ""), type: r.resourceType(), bytes: s ? s.responseBodySize + s.responseHeadersSize : 0, status: res ? res.status() : 0 });
    });
    await page.addInitScript(() => {
      window.__lcp = 0; window.__cls = 0; window.__lcpEl = "";
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__lcpEl = (e.element && (e.element.tagName + "." + String(e.element.className).slice(0, 60))) || e.url || ""; } }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      window.__long = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
    });
    const t0 = Date.now();
    let status = 0;
    try {
      const resp = await page.goto(BASE + path, { waitUntil: "load", timeout: 90000 });
      status = resp ? resp.status() : 0;
      await page.waitForTimeout(4000);
    } catch (e) { errors.push("goto: " + e.message.slice(0, 120)); }
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { ttfb: nav ? Math.round(nav.responseStart) : null, fcp: fcp ? Math.round(fcp.startTime) : null, lcp: Math.round(window.__lcp), lcpEl: window.__lcpEl, cls: +window.__cls.toFixed(3), tbt: Math.round(window.__long), dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null, load: nav ? Math.round(nav.loadEventEnd) : null, lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title };
    }).catch(() => ({}));
    await page.screenshot({ path: `${OUT}/${name}-360.png`, fullPage: false }).catch(() => undefined);
    const byType = {};
    for (const r of reqs) byType[r.type] = (byType[r.type] || 0) + r.bytes;
    results.push({ name, path, status, wall: Date.now() - t0, ...m, requests: reqs.length, kb: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])), totalKb: Math.round(reqs.reduce((s, r) => s + r.bytes, 0) / 1024), api: reqs.filter((r) => r.url.startsWith("/api")).map((r) => `${r.status} ${r.url}`), bad: reqs.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url}`), errors });
    await ctx.close();
  }
  await browser.close();
  require("fs").writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  for (const r of results) console.log(JSON.stringify(r));
})();
