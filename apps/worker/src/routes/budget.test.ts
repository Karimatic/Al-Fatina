/**
 * The daily database write quota belongs to the orders (audit SEC-3): visit counters, error
 * reports and saved checkouts stop writing past the shop-wide budget, and still answer.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { seedShop, testDb } from "../test/db";
import { publicRoutes } from "./public";

function setup(allowed: boolean) {
  const db = testDb();
  seedShop(db);
  const env = { DB: db, IP_HASH_SALT: "s", RL_BEACON: { limit: async () => ({ success: allowed }) } } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.route("/", publicRoutes);
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env, ctx);
  return { db, post };
}
const rows = (db: ReturnType<typeof testDb>, table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first("n");

describe("shop-wide write budget of the counters", () => {
  it("under the budget, a visit is counted", async () => {
    const { db, post } = setup(true);
    expect((await post("/visit", { source: "instagram" })).status).toBe(204);
    expect(await rows(db, "analytics_daily")).toBeGreaterThan(0);
  });

  it("past it, visits, error reports and saved checkouts answer without writing", async () => {
    const { db, post } = setup(false);
    expect((await post("/visit", { source: "instagram" })).status).toBe(204);
    expect((await post("/log", { message: "boom", url: "/x" })).status).toBe(200);
    const cart = await post("/carts", { id: crypto.randomUUID(), lines: [{ variantId: 1, qty: 1 }], phone: "0554650718", channel: "web", locale: "ar" });
    expect(cart.status).toBe(200);
    expect(await rows(db, "analytics_daily")).toBe(0);
    expect(await rows(db, "error_events")).toBe(0);
    expect(await rows(db, "carts")).toBe(0);
  });
});
