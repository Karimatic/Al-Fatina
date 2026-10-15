/**
 * What search engines read (audit SEO-2/SEO-3): the home page says who the shop is, product
 * pages carry the product and its path, every block is valid JSON, and the Arabic/French twins
 * use the same language codes as the sitemap.
 */
import { expect, test, type Page } from "@playwright/test";

async function structured(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => [JSON.parse(b)].flat() as { "@type": string; [k: string]: unknown }[]);
}

test("home: the shop and the site", async ({ page }) => {
  await page.goto("/fr");
  const types = (await structured(page)).map((d) => d["@type"]);
  expect(types).toEqual(expect.arrayContaining(["ClothingStore", "WebSite"]));
  await expect(page.locator('link[rel="alternate"][hreflang="ar-DZ"]')).toHaveCount(1);
  await expect(page.locator('link[rel="alternate"][hreflang="fr-DZ"]')).toHaveCount(1);
});

test("product page: the product and its breadcrumb", async ({ page }) => {
  await page.goto("/produit/pyjama-short-coton-fleuri");
  const data = await structured(page);
  expect(data.map((d) => d["@type"])).toEqual(expect.arrayContaining(["Product", "BreadcrumbList"]));
  const crumbs = data.find((d) => d["@type"] === "BreadcrumbList")!.itemListElement as { name: string; item: string }[];
  expect(crumbs[0]!.name).toBe("الرئيسية");
  expect(crumbs.at(-1)!.item).toMatch(/\/produit\/pyjama-short-coton-fleuri$/);
  await expect(page.locator('link[rel="alternate"][hreflang="fr-DZ"]')).toHaveAttribute("href", /\/fr\/produit\/pyjama-short-coton-fleuri$/);
});
