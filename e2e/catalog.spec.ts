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

test("a product page shows its product without asking the API again (audit R4-5)", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/products/")) asked.push(r.url());
  });
  await page.goto("/fr/produit/pyjama-short-coton-fleuri");
  await expect(page.getByRole("heading", { level: 1, name: "Pyjama short coton fleuri" })).toBeVisible();
  expect(asked).toEqual([]);
});

test("a product with a video shows it in the gallery, without downloading it before it is seen", async ({ page, isMobile }) => {
  const videoRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/media/e2e/video.mp4")) videoRequests.push(r.url());
  });
  await page.goto("/fr/produit/ensemble-satin-ete-lina");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (isMobile) {
    // second slide of the swipe gallery, not loaded until swiped to
    await expect(page.locator("video[aria-label='Vidéo du produit']").first()).toBeAttached();
    await page.waitForTimeout(800);
    expect(videoRequests).toEqual([]);
  } else {
    // a ▶ thumbnail after the main photo; chosen, the video takes the big frame and loads
    expect(videoRequests).toEqual([]);
    await page.getByRole("button", { name: "Vidéo du produit" }).click();
    await expect(page.locator("video[aria-label='Vidéo du produit']:visible")).toBeVisible();
    await expect.poll(() => videoRequests.length).toBeGreaterThan(0);
  }
});
