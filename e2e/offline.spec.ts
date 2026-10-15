/**
 * A weak mobile network (audit REL-3): a page she already opened comes back from the phone's
 * saved copy when the network is gone, with its product; a page never opened shows the offline
 * page.
 */
import { expect, test } from "@playwright/test";
import { quietPage } from "./checkout";

test.beforeEach(async ({ page }) => quietPage(page));

test("offline: a product page she saw comes back, an unseen page says offline", async ({ page, context }) => {
  const product = "/fr/produit/pyjama-short-coton-fleuri";
  await page.goto(product);
  // the store's service worker is installed and in charge; opening the page again saves it
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller != null);
  await page.goto(product);
  await expect(page.getByRole("heading", { level: 1, name: "Pyjama short coton fleuri" })).toBeVisible();

  await context.setOffline(true);
  await page.goto(product);
  await expect(page.getByRole("heading", { level: 1, name: "Pyjama short coton fleuri" })).toBeVisible({ timeout: 15_000 });

  // never opened: the offline page, not an error
  const res = await page.goto("/fr/promotions").catch(() => null);
  expect(res?.status() ?? 200).toBeLessThan(500);
  await expect(page.locator("body")).toContainText("لا يوجد اتصال بالإنترنت");
  await context.setOffline(false);
});
