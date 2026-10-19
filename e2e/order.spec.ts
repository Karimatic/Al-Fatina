/**
 * The path that earns the shop its money, in both languages: a product page, the cart, the
 * order form, the thank-you page with the order code. Runs against the throwaway database of
 * scripts/e2e-server.mjs (demo products), never the real shop.
 */
import { expect, test } from "@playwright/test";
import { fillCheckout, quietPage } from "./checkout";

test.beforeEach(async ({ page }) => quietPage(page));

for (const locale of ["ar", "fr"] as const) {
  test(`order a product, cash on delivery (${locale})`, async ({ page }) => {
    const { t } = await fillCheckout(page, locale);
    await page.getByRole("button", { name: t.submit }).click();

    // the thank-you page shows the order code
    await expect(page).toHaveURL(new RegExp(`${t.prefix}/merci`), { timeout: 20_000 });
    await expect(page.getByText(/AF-[0-9A-Z]{4,10}/).first()).toBeVisible();

    // the private token is out of the address bar (ad pixels read it, audit R5-1), the code stays…
    await expect.poll(() => new URL(page.url()).searchParams.has("t")).toBe(false);
    expect(new URL(page.url()).searchParams.get("c")).toMatch(/^AF-/);
    // …and the page still knows her order after a reload (kept on this phone)
    await page.reload();
    await expect(page.getByText(/AF-[0-9A-Z]{4,10}/).first()).toBeVisible();
    await expect(page.getByText(/\d[\d\s.]*\s?(DA|دج)/).first()).toBeVisible();
  });
}

/**
 * A weak mobile network (audit ORD-1/ORD-4): the order reaches the shop but its answer is lost.
 * The page tries again by itself with the same checkout key and lands on the thank-you page of
 * the one order that exists.
 */
test("the answer to « confirm » is lost: one order, thank-you page", async ({ page, request, baseURL }) => {
  const { t, phone } = await fillCheckout(page, "fr");
  let first = true;
  await page.route("**/api/orders", async (route) => {
    if (!first) return route.continue();
    first = false;
    await route.fetch(); // the shop receives it and creates the order…
    await route.abort("connectionreset"); // …but the phone never gets the answer
  });
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page).toHaveURL(/\/fr\/merci/, { timeout: 30_000 });
  await expect(page.getByText(/AF-[0-9A-Z]{4,10}/).first()).toBeVisible();

  // exactly one order for this number
  const found = await request.post("/api/track", { data: { phone }, headers: { Origin: baseURL! } });
  expect(found.status()).toBe(200);
  expect(((await found.json()) as unknown[]).length).toBe(1);
});
