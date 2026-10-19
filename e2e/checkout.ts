/** Shared steps of the order tests: a product in the cart, the order form filled in. */
import { expect, type Page } from "@playwright/test";

export const L = {
  ar: { prefix: "", title: "بيجامة شورت قطن مزهرة", add: "أضيفي إلى السلة", other: "بلدية أخرى", home: "إلى المنزل", submit: "تأكيد الطلب" },
  fr: { prefix: "/fr", title: "Pyjama short coton fleuri", add: "Ajouter au panier", other: "Autre commune", home: "À domicile", submit: "Confirmer la commande" },
};

/** a new number each run: the shop limits recent orders per phone */
export const newPhone = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

export async function quietPage(page: Page) {
  // no install prompt or assistant bubble over the page
  await page.addInitScript(() => {
    try {
      localStorage.setItem("elfatina.pwaPrompt", "1");
      sessionStorage.setItem("elfatina.assistantHint", "1");
    } catch {}
  });
}

/** A size of the demo pyjama in the cart, then the order form filled (not sent). */
export async function fillCheckout(page: Page, locale: "ar" | "fr", phone = newPhone()) {
  const t = L[locale];
  await page.goto(`${t.prefix}/produit/pyjama-short-coton-fleuri`);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();

  // pick a size, then add to the cart
  const main = page.locator("main");
  await main.getByRole("button", { name: "M", exact: true }).first().click();
  await main.getByRole("button", { name: t.add }).first().click();

  await page.goto(`${t.prefix}/commande`);
  await page.locator("#f-name").fill("Test Navigateur");
  await page.locator("#f-phone").fill(phone);

  const dialog = page.getByRole("dialog");
  await page.locator("#f-wilaya").click();
  await dialog.locator("input").first().fill("16");
  await dialog.getByRole("option").filter({ hasText: /^16/ }).first().click();
  await page.locator("#f-communeId").click();
  await dialog.getByRole("option").filter({ hasNotText: t.other }).first().click();

  await page.getByText(t.home, { exact: true }).click();
  await page.locator("#f-address").fill("12 rue des Roses, Alger Centre");
  return { t, phone };
}
