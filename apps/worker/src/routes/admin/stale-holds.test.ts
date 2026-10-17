/**
 * No captcha (the owner's choice), so fake orders could keep the stock (audit SEC-1): site
 * orders unconfirmed for 48 h are listed with the pieces they hold, and « Libérer le stock »
 * cancels them once and gives the pieces back. Team orders and recent ones are never listed.
 */
import { describe, expect, it } from "vitest";
import { addOrder, seedShop, testApp, testDb } from "../../test/db";
import { orderRoutes } from "./orders";

describe("unconfirmed site orders holding stock", () => {
  it("lists only old site orders, and frees their pieces once", async () => {
    const db = testDb();
    seedShop(db);
    const old = Date.now() - 50 * 3600_000;
    const stale = addOrder(db, { status: "nouvelle", createdAt: old, items: [{ variantId: 1, qty: 2 }] });
    db.sqlite.exec(`INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (${stale}, 'call', 'Ilyas', 'admin', 'Appel', 1)`);
    addOrder(db, { status: "nouvelle", createdAt: old, phone: "0770000001" }); // nobody called it yet: not offered
    addOrder(db, { status: "injoignable", createdAt: Date.now() - 3600_000, phone: "0661223344", customerId: 2 }); // recent
    addOrder(db, { status: "nouvelle", createdAt: old, channel: "instagram" }); // taken by the team
    db.sqlite.exec("UPDATE variants SET stock_reserved = 5 WHERE id = 1"); // the four orders' pieces

    const app = testApp(orderRoutes, db);
    const list = await app.call<{ orders: number; pieces: number; ids: number[] }>("GET", "/orders/stale-holds");
    expect(list.body).toMatchObject({ orders: 1, pieces: 2, ids: [stale] });

    const free = () => app.call<{ done: string[]; failed: unknown[] }>("POST", "/orders/bulk-status", { ids: list.body.ids, to: "annulee", reason: "unreachable" });
    expect((await free()).body.done).toHaveLength(1);
    expect((await free()).body.done).toHaveLength(0); // pressed twice: nothing more
    expect(db.sqlite.prepare("SELECT stock_reserved AS n FROM variants WHERE id = 1").get()).toEqual({ n: 3 });
    expect(db.sqlite.prepare("SELECT status, outcome_reason FROM orders WHERE id = ?").get(stale)).toEqual({ status: "annulee", outcome_reason: "unreachable" });
    expect((await app.call<{ orders: number }>("GET", "/orders/stale-holds")).body.orders).toBe(0);
  });
});
