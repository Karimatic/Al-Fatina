/**
 * Free-plan headroom and promo fairness (audit PERF-3, ORD-3): the public cache is emptied only
 * when a size runs out or comes back; a cancelled order gives its promo use back; the category
 * counts are read in one pass.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { applyStatusChange, createOrder, crossesZero, type NewOrder } from "./orders";
import { listCategories } from "./catalog";
import { seedShop, testDb, type TestDb } from "../test/db";

const envOf = (db: TestDb) => ({ DB: db, ENVIRONMENT: "development", PUBLIC_ORIGIN: "http://localhost", MEDIA_ORIGIN: "", TRACK_TOKEN_PEPPER: "p" }) as unknown as Env;
const order = (over: Partial<NewOrder> = {}): NewOrder => ({
  idempotencyKey: crypto.randomUUID(),
  name: "Amina", phone: "0554650718", wilaya: 16, communeId: null, communeText: "Alger centre",
  deliveryType: "bureau", lines: [{ variantId: 1, qty: 1 }], channel: "web", locale: "ar", ipHash: "iphash", ...over,
});
function shop(sql = "") {
  const db = testDb();
  seedShop(db); // variants: 1 (20 on hand), 2 (10 on hand, 2 reserved), 3 (5 on hand)
  db.sqlite.exec(`UPDATE wilayas SET desk_price = 400, is_active = 1 WHERE code = 16; ${sql}`);
  return db;
}
const version = (db: TestDb) => db.prepare("SELECT value FROM settings WHERE key = 'catalog_version'").first("value");

describe("public cache", () => {
  it("an order that leaves stock doesn't empty the cache; one that takes the last piece does", async () => {
    const db = shop("UPDATE variants SET stock_on_hand = 1 WHERE id = 3");
    await createOrder(envOf(db), order());
    expect(await version(db)).toBeNull();
    await createOrder(envOf(db), order({ lines: [{ variantId: 3, qty: 1 }] }));
    expect(await version(db)).not.toBeNull();
  });

  it("only a move across zero counts", () => {
    expect(crossesZero(5, "reserve", 1)).toBe(false);
    expect(crossesZero(1, "reserve", 1)).toBe(true);
    expect(crossesZero(0, "release", 1)).toBe(true);
    expect(crossesZero(3, "commit", 1)).toBe(false); // on hand and reserved both drop
    expect(crossesZero(0, "restock", 2)).toBe(true);
  });
});

describe("promo use on cancel / reopen", () => {
  it("comes back when cancelled, is taken again when reopened, refused when none left", async () => {
    const db = shop("INSERT INTO coupons (code, type, value, is_active, usage_limit, used_count) VALUES ('ONE', 'percent', 10, 1, 1, 0)");
    const env = envOf(db);
    const o = await createOrder(env, order({ coupon: "ONE" }));
    const used = () => db.prepare("SELECT used_count AS n FROM coupons WHERE code = 'ONE'").first("n");
    expect(await used()).toBe(1);
    await applyStatusChange(env, o.id, "annulee", "member:1:A", "admin");
    expect(await used()).toBe(0);
    await applyStatusChange(env, o.id, "nouvelle", "member:1:A", "admin");
    expect(await used()).toBe(1);
    // another order took the only use meanwhile: reopening this one is refused, nothing changes
    await applyStatusChange(env, o.id, "annulee", "member:1:A", "admin");
    await createOrder(env, order({ coupon: "ONE", phone: "0661223344" }));
    await expect(applyStatusChange(env, o.id, "nouvelle", "member:1:A", "admin")).rejects.toMatchObject({ code: "coupon_exhausted" });
    expect(await db.prepare("SELECT status FROM orders WHERE id = ?").bind(o.id).first("status")).toBe("annulee");
  });
});

describe("categories", () => {
  it("a main category counts its active sub-categories' published products", async () => {
    const db = shop(`INSERT INTO categories (id, slug, name_fr, name_ar, parent_id) VALUES (901, 'test-ete', 'Été', 'صيف', 900), (902, 'test-off', 'Off', 'x', 900);
      UPDATE categories SET is_active = 0 WHERE id = 902;
      INSERT INTO products (id, slug, name_fr, name_ar, status, category_id, price) VALUES (2, 'p2', 'P2', 'P2', 'published', 901, 1000), (3, 'p3', 'P3', 'P3', 'draft', 901, 1000), (4, 'p4', 'P4', 'P4', 'published', 902, 1000);`);
    const cats = await listCategories(envOf(db));
    expect(cats.find((c) => c.id === 900)?.productCount).toBe(2); // its own + the active sub-category's published one
    expect(cats.find((c) => c.id === 901)?.productCount).toBe(1);
    expect(cats.find((c) => c.id === 902)).toBeUndefined();
  });
});
