import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { csvCell } from "../../lib/csv";
import { createOrder, quote } from "../../lib/orders";
import { member, seedShop, testApp, testDb, type TestDb } from "../../test/db";
import { catalogRoutes } from "./catalog";
import { notifierRoutes } from "./notifier";
import { systemRoutes } from "./system";
import { teamRoutes } from "./team";

const envOf = (db: TestDb) => ({ DB: db, ENVIRONMENT: "development", PUBLIC_ORIGIN: "http://localhost:8787", MEDIA_ORIGIN: "" }) as unknown as Env;
let n = 10;
const order = (extra: Record<string, unknown> = {}) => ({
  idempotencyKey: crypto.randomUUID(), name: "Amina", phone: `05546507${n++}`, wilaya: 35, communeId: null, communeText: "Dellys",
  deliveryType: "domicile" as const, address: "Cité 200 logements", lines: [{ variantId: 1, qty: 1 }], channel: "web" as const, locale: "ar" as const, ...extra,
});
function shop() {
  const db = testDb();
  seedShop(db);
  db.sqlite.exec("UPDATE wilayas SET home_price = 500, desk_price = 300, is_active = 1 WHERE code = 35");
  return db;
}

describe("security", () => {
  it("loyalty points show and apply only on a phone holding one of her order links", async () => {
    const db = shop();
    const env = envOf(db);
    const first = await createOrder(env, order());
    const phone = (await db.prepare("SELECT phone FROM orders WHERE id = ?").bind(first.id).first("phone")) as string;
    db.sqlite.exec(`UPDATE settings SET value = json_set(value, '$.enabled', json('true')) WHERE key = 'loyalty'; UPDATE customers SET points_balance = 500 WHERE phone = '${phone}'`);
    const ask = (proofs?: { code: string; token: string }[]) => quote(env, { lines: [{ variantId: 1, qty: 1 }], wilaya: 35, deliveryType: "domicile", phone, usePoints: true, proofs });
    expect((await ask()).points).toBeNull(); // her number alone: nothing
    expect((await ask([{ code: first.code, token: "guessed" }])).points).toBeNull();
    expect((await ask([{ code: first.code, token: first.token }])).points?.applied).toBe(true);
  });

  it("a store order can't hold a whole shelf", async () => {
    const db = shop();
    await expect(createOrder(envOf(db), order({ lines: [{ variantId: 1, qty: 11 }] }))).rejects.toMatchObject({ code: "too_many_pieces" });
    // the team (in the admin) is not limited
    expect((await createOrder(envOf(db), order({ lines: [{ variantId: 1, qty: 11 }], actor: "member:1:Ilyas" }))).id).toBeGreaterThan(0);
  });

  it("the purchase price is hidden without the cost permission", async () => {
    const db = shop();
    db.sqlite.exec("UPDATE products SET cost_price = 1200 WHERE id = 1");
    const viewer = testApp(catalogRoutes, db, member(["products.view"]));
    expect((await viewer.call<{ costPrice: number | null }>("GET", "/products/1")).body.costPrice).toBeNull();
    const costs = testApp(catalogRoutes, db, member(["products.view", "cost.view"]));
    expect((await costs.call<{ costPrice: number | null }>("GET", "/products/1")).body.costPrice).toBe(1200);
  });

  it("the Errors page shows the team's activity log and message retries only with their own permissions", async () => {
    const db = shop();
    const app = testApp(systemRoutes, db, member(["errors.view"]));
    expect((await app.call<{ audit: unknown }>("GET", "/errors")).body.audit).toBeNull();
    expect((await app.call("POST", "/outbox/1/retry")).status).toBe(403);
    expect(Array.isArray((await app.as(member(["errors.view", "audit.view"])).call<{ audit: unknown }>("GET", "/errors")).body.audit)).toBe(true);
  });

  it("a manager can't re-invite (reset) an account with more rights than hers", async () => {
    const db = shop();
    db.sqlite.exec(`INSERT INTO roles (key, name, permissions) VALUES ('custom-77', 'Comptable', '["finance.view","finance.edit","orders.view"]');
      INSERT INTO team_members (id, email, name, role_id, is_active, created_at) VALUES (77, 'compta@shop.dz', 'Compta', (SELECT id FROM roles WHERE key = 'custom-77'), 1, 0)`);
    const manager = testApp(teamRoutes, db, member(["team.manage", "orders.view"]));
    expect((await manager.call("POST", "/team/77/invite")).status).toBe(403);
  });

  it("spreadsheet exports never run a customer's text as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("Amina")).toBe(`"Amina"`);
  });

  it("a push notification can only open a page of the shop", async () => {
    const app = testApp(notifierRoutes, shop());
    const send = (path: string) => app.call("POST", "/notifier/broadcast", { titleFr: "Nouveau", titleAr: "جديد", bodyFr: "Venez voir", bodyAr: "تعالي", path });
    expect((await send("//evil.com")).status).toBe(422);
    expect((await send("/\\evil.com")).status).toBe(422);
  });
});
