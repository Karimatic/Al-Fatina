/**
 * Meta / TikTok pixels: nothing is loaded or sent before the visitor agrees; after « D'accord »
 * both load and get PageView, ViewContent and AddToCart; « Non merci » is remembered. The pixel
 * ids are put in /api/site by the test and the two scripts answered by empty files, so nothing
 * leaves the machine.
 */
import { expect, test, type Page } from "@playwright/test";
import { quietPage } from "./checkout";

const PRODUCT = "/fr/produit/pyjama-short-coton-fleuri";

async function withPixels(page: Page) {
  const loaded: string[] = [];
  await page.route("**/api/site", async (route) => {
    const res = await route.fetch();
    const site = await res.json();
    await route.fulfill({ response: res, json: { ...site, pixels: { meta: "1234567890", tiktok: "CTEST123" } } });
  });
  for (const host of ["https://connect.facebook.net/**", "https://analytics.tiktok.com/**"]) {
    await page.route(host, (route) => {
      loaded.push(new URL(route.request().url()).hostname);
      return route.fulfill({ contentType: "text/javascript", body: "" });
    });
  }
  return loaded;
}

type Queues = { meta: unknown[][]; tiktok: unknown[][] };
const queues = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { fbq?: { queue: unknown[][] }; ttq?: unknown[][] };
    return { meta: w.fbq?.queue ?? [], tiktok: (w.ttq ?? []).filter(Array.isArray) } as Queues;
  });

// the test rewrites /api/site in the page: the store's service worker would fetch around it
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => quietPage(page));

test("pixels wait for consent, then count the visit and the product", async ({ page }) => {
  const loaded = await withPixels(page);
  await page.goto("/fr");
  const card = page.getByRole("region", { name: "Publicités" });
  await expect(card).toBeVisible();
  await page.waitForTimeout(1500);
  expect(loaded).toEqual([]); // nothing before she answers
  expect(await page.evaluate(() => "fbq" in window || "ttq" in window)).toBe(false);

  await card.getByRole("button", { name: "D'accord" }).click();
  await expect(card).toBeHidden();
  await expect.poll(() => [...new Set(loaded)].sort()).toEqual(["analytics.tiktok.com", "connect.facebook.net"]);
  let q = await queues(page);
  expect(q.meta).toContainEqual(["init", "1234567890"]);
  expect(q.meta).toContainEqual(["track", "PageView"]);

  // a product page: ViewContent with the same id as the Meta catalogue feed
  await page.goto(PRODUCT);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(async () => (await queues(page)).meta.some((e) => e[1] === "ViewContent")).toBe(true);
  q = await queues(page);
  const view = q.meta.find((e) => e[1] === "ViewContent")!;
  expect(view[2]).toMatchObject({ currency: "DZD", content_type: "product_group" });
  expect((view[2] as { content_ids: string[] }).content_ids[0]).toMatch(/^EF-P\d+$/);
  expect(q.tiktok.some((e) => e[0] === "track" && e[1] === "ViewContent")).toBe(true);
  await expect(page.getByRole("region", { name: "Publicités" })).toBeHidden(); // answered once
});

test("« Non merci »: nothing loads, and the question isn't asked again", async ({ page }) => {
  const loaded = await withPixels(page);
  await page.goto("/fr");
  await page.getByRole("region", { name: "Publicités" }).getByRole("button", { name: "Non merci" }).click();
  await page.goto(PRODUCT);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(loaded).toEqual([]);
  await expect(page.getByRole("region", { name: "Publicités" })).toBeHidden();
});
