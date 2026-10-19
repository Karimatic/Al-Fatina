/**
 * What axe can't see: keyboard behaviour of the pop-up panels (WAI-ARIA modal dialog). Opening
 * moves the focus inside, Tab never leaves the panel, Escape closes it and the focus returns to
 * the button that opened it.
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("elfatina.pwaPrompt", "1");
      sessionStorage.setItem("elfatina.assistantHint", "1");
    } catch {}
  });
});

test("« similar models » panel: focus in, Tab trapped, Escape back to the button", async ({ page }) => {
  await page.goto("/fr/produit/pyjama-short-coton-fleuri");
  await page.waitForLoadState("networkidle");
  const opener = page.getByRole("button", { name: /modèles similaires/i });
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Modèles similaires" });
  await expect(dialog).toBeVisible();
  const focusInside = () => dialog.evaluate((d) => d.contains(document.activeElement));
  expect(await focusInside()).toBe(true);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press(i % 4 === 3 ? "Shift+Tab" : "Tab");
    expect(await focusInside()).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("menu: Tab stays inside while it is open", async ({ page }) => {
  await page.goto("/fr");
  await page.waitForLoadState("networkidle");
  const opener = page.getByRole("button", { name: "Menu" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Menu" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});
