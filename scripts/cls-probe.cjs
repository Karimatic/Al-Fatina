/**
 * Which elements move while a page loads, on a slow phone (360 px, slow 4G, 4× slower CPU).
 *   PATHS=/,/panier node scripts/cls-probe.cjs          (PERF_BASE: default the local test server)
 */
const { chromium } = require("playwright");
const BASE = process.env.PERF_BASE || "http://127.0.0.1:8799";
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const path of (process.env.PATHS || "/,/fr,/c/pyjamas,/panier,/commande").split(",")) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("elfatina.pwaPrompt", "1");
        sessionStorage.setItem("elfatina.assistantHint", "1");
      } catch {}
      window.__shifts = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          if (!e.hadRecentInput)
            window.__shifts.push({
              v: +e.value.toFixed(3),
              t: Math.round(e.startTime),
              src: (e.sources || []).slice(0, 3).map((s) => (s.node ? `${s.node.nodeName}.${String(s.node.className || "").slice(0, 60)} y ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}` : "?")),
            });
      }).observe({ type: "layout-shift", buffered: true });
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => window.__shifts);
    console.log(path, "CLS", s.reduce((a, b) => a + b.v, 0).toFixed(3));
    for (const x of s.filter((x) => x.v >= 0.005)) console.log("   ", x.v, "@", x.t, "ms", x.src.join(" | "));
    await ctx.close();
  }
  await browser.close();
})();
