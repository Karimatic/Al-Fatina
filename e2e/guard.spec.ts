/**
 * Protections a visitor can't see: forms sent without the page (a script) are refused, and every
 * page carries its security headers.
 */
import { expect, test } from "@playwright/test";

test("a form posted straight to the API, without the page's ticket, is refused", async ({ request, baseURL }) => {
  const res = await request.post("/api/contact", {
    headers: { Origin: baseURL! },
    data: { name: "Script", message: "Bonjour, ceci est un robot" },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe("form_expired");
});

test("store pages carry a strict content security policy", async ({ request }) => {
  const res = await request.get("/fr");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).toMatch(/img-src 'self' data: blob:(;| )/);
  expect(csp).toContain("object-src 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});
