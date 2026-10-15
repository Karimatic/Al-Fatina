/**
 * Cashier double tap (audit R2-5): the sale form sends one key per sale, so two taps on
 * « Vendre » — or a retry after a lost answer — make one sale and one stock exit.
 */
import { describe, expect, it } from "vitest";
import { member, seedShop, testApp, testDb } from "../../test/db";
import { salesRoutes } from "./sales";

const sale = (key: string) => ({ channel: "boutique", status: "livree", lines: [{ variantId: 1, qty: 1 }], idempotencyKey: key });

describe("cashier sale", () => {
  it("two taps at once, then a retry: one sale", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(salesRoutes, db, member(["sales.create"]));
    const key = "b0000000-0000-4000-8000-000000000001";
    const [a, b] = await Promise.all([app.call<{ code: string }>("POST", "/sales/manual", sale(key)), app.call<{ code: string }>("POST", "/sales/manual", sale(key))]);
    const again = await app.call<{ code: string }>("POST", "/sales/manual", sale(key));
    expect(new Set([a.body.code, b.body.code, again.body.code]).size).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_movements").get()).toEqual({ n: 1 });
  });

  it("the next customer (a new key) is a new sale", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(salesRoutes, db, member(["sales.create"]));
    await app.call("POST", "/sales/manual", sale("b0000000-0000-4000-8000-000000000001"));
    await app.call("POST", "/sales/manual", sale("b0000000-0000-4000-8000-000000000002"));
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 2 });
  });
});
