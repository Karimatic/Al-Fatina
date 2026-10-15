/**
 * A main category (Pyjamas: its pieces are in « été » / « hiver ») on a slow connection where the
 * category list comes 2.5 s after the products (audit R3-1): the page must never say it is empty.
 */
import { expect, test } from "@playwright/test";
import { quietPage } from "./checkout";

test.beforeEach(async ({ page }) => quietPage(page));

test("a main category never flashes « no articles » while loading", async ({ page }) => {
  // remember if the empty message was ever on the page, even for a moment
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.textContent?.includes("Aucun article dans cette catégorie")) (window as unknown as { sawEmpty: boolean }).sawEmpty = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.route("**/api/categories", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto("/fr/c/pyjamas");
  await expect(page.locator("main a[href*='/produit/']").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { sawEmpty?: boolean }).sawEmpty ?? false)).toBe(false);
});
