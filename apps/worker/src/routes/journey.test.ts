/**
 * The visitors' way to an order (audit OBS-3): the store reports each step once per visit, the
 * Stats page shows visits → product → cart → order form → ordered for the period.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AdminMember, AppEnv, Env } from "../env";
import { HttpError } from "../lib/http";
import { seedShop, testDb } from "../test/db";
import { dashboardRoutes } from "./admin/dashboard";
import { publicRoutes } from "./public";

function setup(allowed = true) {
  const db = testDb();
  seedShop(db);
  const env = { DB: db, IP_HASH_SALT: "s", RL_BEACON: { limit: async () => ({ success: allowed }) } } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use("/admin/*", async (c, next) => {
    c.set("member", { id: 1, permissions: ["stats.view"] } as unknown as AdminMember);
    await next();
  });
  app.route("/admin", dashboardRoutes);
  app.route("/", publicRoutes);
  app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.code }, err.status) : c.json({ error: "internal_error" }, 500)));
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const step = (body: unknown) => app.request("/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env, ctx);
  const stats = async () => ((await (await app.request("/admin/stats?range=7", {}, env, ctx)).json()) as { journey: Record<string, number> }).journey;
  return { db, step, stats };
}

describe("visitor journey", () => {
  it("steps are counted and shown against the visits", async () => {
    const { db, step, stats } = setup();
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    db.prepare("INSERT INTO analytics_daily (date, metric, dim, value) VALUES (?, 'visits', 'instagram', 10), (?, 'visits', 'direct', 10)").bind(today, today).run();
    for (const s of ["product", "product", "cart", "checkout"]) expect((await step({ step: s })).status).toBe(204);
    expect(await stats()).toEqual({ visits: 20, product: 2, cart: 1, checkout: 1, ordered: 0 });
  });

  it("an unknown step is refused, and past the shop-wide budget nothing is written", async () => {
    expect((await setup().step({ step: "payment" })).status).toBe(422);
    const { step, stats } = setup(false);
    expect((await step({ step: "cart" })).status).toBe(204);
    expect((await stats()).cart).toBe(0);
  });
});
