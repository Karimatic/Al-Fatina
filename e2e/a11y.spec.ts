/**
 * Accessibility gate: axe (WCAG 2.2 A and AA rules, audit A11Y-1) on the main pages, in Arabic and French, on
 * a phone and a computer. Any violation fails CI, with the rule and the elements concerned.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// 2.2 adds the 24 × 24 px minimum for tap targets (2.5.8)
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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
      localStorage.setItem("elfatina.pwaPrompt", "1");
      sessionStorage.setItem("elfatina.assistantHint", "1");
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
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
      expect(report, report.join("\n")).toEqual([]);
    });
  }
}

// states that only exist after an action: checked every time, not by luck of timing
for (const prefix of ["", "/fr"]) {
  test(`axe ${prefix || "/"} search suggestions open`, async ({ page }) => {
    await page.goto(`${prefix}/recherche`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("combobox").pressSequentially("pyj", { delay: 50 });
    await expect(page.locator("#search-suggest [role=option]").first()).toBeVisible();
    // the open list covers the results under it, as any drop-down does: tap sizes are checked
    // inside the list (the results are checked on their own page above)
    const page_ = await new AxeBuilder({ page }).withTags(TAGS).disableRules(["target-size"]).analyze();
    const list = await new AxeBuilder({ page }).include("#search-suggest").withRules(["target-size"]).analyze();
    const violations = [...page_.violations, ...list.violations];
    const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
    expect(report, report.join("\n")).toEqual([]);
  });
}
