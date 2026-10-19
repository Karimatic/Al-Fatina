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

/**
 * Loyalty points spent twice at the same instant (audit ORD-6, round 2 R2-6): two checkouts
 * started together with the same 100 points, through the real order code. One gets them, the
 * other is refused with « points_changed », the balance never goes below zero.
 */
describe("loyalty points, two orders at once", () => {
  it("only one order spends them", async () => {
    const db = shop(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('loyalty', '{"enabled":true,"points_per_100da":1,"redeem_value_da":5,"min_redeem":100,"expiry_days":365}', 0)`);
    const env = envOf(db);
    // her earlier order is the proof that the number is hers
    const proof = await createOrder(env, order({ idempotencyKey: "a0000000-0000-4000-8000-000000000001" }));
    db.sqlite.exec("UPDATE orders SET status = 'livree'; UPDATE customers SET points_balance = 100 WHERE phone = '0554650718'");
    const spend = (key: string) =>
      createOrder(env, order({ idempotencyKey: key, usePoints: true, proofs: [{ code: proof.code, token: proof.token }] }));
    const results = await Promise.allSettled([spend("a0000000-0000-4000-8000-000000000002"), spend("a0000000-0000-4000-8000-000000000003")]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409, code: "points_changed" });
    expect(await count(db, "SELECT points_balance AS n FROM customers WHERE phone = '0554650718'")).toBe(0);
    expect(await count(db, "SELECT COUNT(*) AS n FROM orders WHERE points_used > 0")).toBe(1);
  });
});

/**
 * Shared mobile addresses (audit R3-3): many unconfirmed orders from one connection are flagged
 * for the team from 12, refused only from 40 (a script, not a busy operator gateway).
 */
describe("unconfirmed orders from one connection", () => {
  const pile = (db: TestDb, n: number) => {
    const now = Date.now();
    for (let i = 0; i < n; i++)
      db.sqlite.exec(`INSERT INTO orders (public_code, track_token_hash, idempotency_key, status, channel, customer_id, name, phone, wilaya_code, delivery_type, subtotal, shipping_price, total, ip_hash, created_at, updated_at)
        VALUES ('AF-P${i}', 'x', 'k-${i}', 'nouvelle', 'web', 1, 'X', '05500000${String(i).padStart(2, "0")}', 16, 'bureau', 3000, 400, 3400, 'iphash', ${now}, ${now})`);
  };
  it("12 today: her order goes through, flagged for the team", async () => {
    const db = shop();
    pile(db, 12);
    const o = await createOrder(envOf(db), order());
    const flags = JSON.parse(String(await db.prepare("SELECT risk_flags AS n FROM orders WHERE id = ?").bind(o.id).first("n")));
    expect(flags).toContain("ip_pending");
  });
  it("more than 60 pieces held today by one connection: refused (audit R4-2)", async () => {
    const db = shop();
    pile(db, 6);
    db.sqlite.exec("INSERT INTO order_items (order_id, variant_id, product_id, name_fr, name_ar, sku, unit_price, qty) SELECT id, 1, 1, 'Pyjama', 'Pyjama', 'PJ', 3000, 10 FROM orders"); // 6 × 10 pieces
    await expect(createOrder(envOf(db), order())).rejects.toMatchObject({ status: 429, code: "too_many_orders" });
  });

  it("40 today: refused", async () => {
    const db = shop();
    pile(db, 40);
    await expect(createOrder(envOf(db), order())).rejects.toMatchObject({ status: 429, code: "too_many_orders" });
  });
});

