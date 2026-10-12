/**
 * Accessibility gate: axe (WCAG 2.1 A and AA rules) on the main pages, in Arabic and French, on
 * a phone and a computer. Any violation fails CI, with the rule and the elements concerned.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/boutique",
  "/categories",
  "/nouveautes",
  "/promotions",
  "/produit/pyjama-short-coton-fleuri",
  "/panier",
  "/commande",
  "/contact",
  "/suivi",
  "/recherche?q=pyjama",
  "/favoris",
  "/p/cgv",
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("henine.pwaPrompt", "1");
      sessionStorage.setItem("henine.assistantHint", "1");
    } catch {}
  });
});

for (const prefix of ["", "/fr"]) {
  for (const path of PAGES) {
    const url = prefix ? (path === "/" ? "/fr" : `/fr${path}`) : path;
    test(`axe ${url}`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      // the page's entrance animations are done
      await page.waitForTimeout(800);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
      expect(report, report.join("\n")).toEqual([]);
    });
  }
}
