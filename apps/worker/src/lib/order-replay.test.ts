/**
 * A lost answer + "press again" (audit ORD-1/ORD-2): the same checkout key must always give back
 * the first order (its code and private link), never a second order, and never "sold out" /
 * "promo used up" because her own first order took the last piece or the last use.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { createOrder, type NewOrder } from "./orders";
import { seedShop, testDb, type TestDb } from "../test/db";
import { publicRoutes } from "../routes/public";

const KEY = "0b9c6a2e-1f0e-4c1a-9d7e-3f2b8a1c5d40";
const envOf = (db: TestDb) =>
  ({ DB: db, ENVIRONMENT: "development", PUBLIC_ORIGIN: "http://localhost:8787", MEDIA_ORIGIN: "", TRACK_TOKEN_PEPPER: "p", IP_HASH_SALT: "s" }) as unknown as Env;
const order = (over: Partial<NewOrder> = {}): NewOrder => ({
  idempotencyKey: KEY,
  name: "Amina", phone: "0554650718", wilaya: 16, communeId: null, communeText: "Alger centre",
  deliveryType: "bureau", lines: [{ variantId: 3, qty: 1 }], channel: "web", locale: "ar", ipHash: "iphash", ...over,
});
function shop(sql = "") {
  const db = testDb();
  seedShop(db);
  db.sqlite.exec(`UPDATE wilayas SET desk_price = 400, is_active = 1 WHERE code = 16; ${sql}`);
  return db;
}
const count = (db: TestDb, sql: string) => db.prepare(sql).first("n");

describe("same checkout key → the first order, every time", () => {
  it("plenty of stock: one order, same code and same private link", async () => {
    const db = shop();
    const first = await createOrder(envOf(db), order());
    const again = await createOrder(envOf(db), order());
    expect(again).toMatchObject({ code: first.code, token: first.token, total: first.total });
    expect(await count(db, "SELECT COUNT(*) AS n FROM orders")).toBe(1);
  });

  it("her order took the last piece: the retry is her order, not « sold out »", async () => {
    const db = shop("UPDATE variants SET stock_on_hand = 1 WHERE id = 3");
    const first = await createOrder(envOf(db), order());
    const again = await createOrder(envOf(db), order());
    expect(again).toMatchObject({ code: first.code, token: first.token });
    expect(await count(db, "SELECT stock_reserved AS n FROM variants WHERE id = 3")).toBe(1);
  });

  it("her order used the last promo use: the retry is her order, the promo counted once", async () => {
    const db = shop("INSERT INTO coupons (code, type, value, is_active, usage_limit, used_count) VALUES ('ONE', 'percent', 10, 1, 1, 0)");
    const first = await createOrder(envOf(db), order({ coupon: "ONE" }));
    const again = await createOrder(envOf(db), order({ coupon: "ONE" }));
    expect(again).toMatchObject({ code: first.code, token: first.token });
    expect(await count(db, "SELECT used_count AS n FROM coupons WHERE code = 'ONE'")).toBe(1);
    expect(await count(db, "SELECT COUNT(*) AS n FROM outbox")).toBe(1); // one Telegram message
  });

  it("the store's endpoint answers a retry with the first order before any other check", async () => {
    const db = shop();
    const env = envOf(db);
    const first = await createOrder(env, order());
    // the shop has just closed and the retry carries no bot-check ticket: still her order
    db.sqlite.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('maintenance', '{"active":true}', 0)`);
    const app = new Hono<AppEnv>();
    app.onError((err, c) => c.json({ error: (err as { code?: string }).code }, ((err as { status?: number }).status ?? 500) as 400));
    app.route("/", publicRoutes);
    const res = await app.request(
      "/orders",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...order(), communeId: null, lines: [{ variantId: 3, qty: 1 }] }) },
      env,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: first.code, token: first.token });
  });
});
