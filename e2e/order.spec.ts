/**
 * The path that earns the shop its money, in both languages: a product page, the cart, the
 * order form, the thank-you page with the order code. Runs against the throwaway database of
 * scripts/e2e-server.mjs (demo products), never the real shop.
 */
import { expect, test } from "@playwright/test";

const L = {
  ar: { prefix: "", title: "بيجامة شورت قطن مزهرة", add: "أضيفي إلى السلة", other: "بلدية أخرى", home: "إلى المنزل", submit: "تأكيد الطلب" },
  fr: { prefix: "/fr", title: "Pyjama short coton fleuri", add: "Ajouter au panier", other: "Autre commune", home: "À domicile", submit: "Confirmer la commande" },
};

test.beforeEach(async ({ page }) => {
  // no install prompt or assistant bubble over the page
  await page.addInitScript(() => {
    try {
      localStorage.setItem("henine.pwaPrompt", "1");
      sessionStorage.setItem("henine.assistantHint", "1");
    } catch {}
  });
});

for (const locale of ["ar", "fr"] as const) {
  test(`order a product, cash on delivery (${locale})`, async ({ page }) => {
    const t = L[locale];
    await page.goto(`${t.prefix}/produit/pyjama-short-coton-fleuri`);
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

    // pick a size, then add to the cart
    const main = page.locator("main");
    await main.getByRole("button", { name: "M", exact: true }).first().click();
    await main.getByRole("button", { name: t.add }).first().click();

    await page.goto(`${t.prefix}/commande`);
    await page.locator("#f-name").fill("Test Navigateur");
    // a new number each run: the shop limits recent orders per phone
    await page.locator("#f-phone").fill(`05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);

    const dialog = page.getByRole("dialog");
    await page.locator("#f-wilaya").click();
    await dialog.locator("input").first().fill("16");
    await dialog.getByRole("option").filter({ hasText: /^16/ }).first().click();
    await page.locator("#f-communeId").click();
    await dialog.getByRole("option").filter({ hasNotText: t.other }).first().click();

    await page.getByText(t.home, { exact: true }).click();
    await page.locator("#f-address").fill("12 rue des Roses, Alger Centre");
    await page.getByRole("button", { name: t.submit }).click();

    // the thank-you page shows the order code
    await expect(page).toHaveURL(new RegExp(`${t.prefix}/merci`), { timeout: 20_000 });
    await expect(page.getByText(/HN-[0-9A-Z]{4,10}/).first()).toBeVisible();
  });
}
