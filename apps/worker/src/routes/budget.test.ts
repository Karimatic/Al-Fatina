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

  it("past it, visits and error reports answer without writing", async () => {
    const { db, post } = setup(false);
    expect((await post("/visit", { source: "instagram" })).status).toBe(204);
    expect((await post("/log", { message: "boom", url: "/x" })).status).toBe(200);
    expect(await rows(db, "analytics_daily")).toBe(0);
    expect(await rows(db, "error_events")).toBe(0);
  });
});

/** A fake rate limit: `max` calls per key (the real ones count per minute). */
function limiter(max: number) {
  const seen = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    limit: async ({ key }: { key: string }) => {
      calls.push(key);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { success: n <= max };
    },
  };
}

describe("one visitor can't use up the shop-wide budget (audit R2-3)", () => {
  it("past her own share, her requests no longer touch the shared budget; others are still counted", async () => {
    const db = testDb();
    seedShop(db);
    const shared = limiter(20);
    const env = { DB: db, IP_HASH_SALT: "s", RL_BEACON: shared, RL_BEACON_IP: limiter(10) } as unknown as Env;
    const app = new Hono<AppEnv>();
    app.route("/", publicRoutes);
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const visit = (ip: string) =>
      app.request("/visit", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: "{}" }, env, ctx);

    for (let i = 0; i < 50; i++) expect((await visit("6.6.6.6")).status).toBe(204); // a script
    expect(shared.calls.length).toBe(10); // only her share reached the shared budget
    await visit("41.100.1.2"); // a real visitor
    expect(await db.prepare("SELECT SUM(value) AS n FROM analytics_daily WHERE metric = 'visits'").first("n")).toBe(11);
  });
});

