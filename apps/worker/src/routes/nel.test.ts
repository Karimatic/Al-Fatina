/**
 * Network Error Logging: the browser's reports of pages it could not load land in Admin →
 * Erreurs (« network »), failures only, without the address's query; no Origin needed.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { sameOriginWrites } from "../middleware/security";
import { seedShop, testDb } from "../test/db";
import { publicRoutes } from "./public";

function setup() {
  const db = testDb();
  seedShop(db);
  const env = { DB: db, IP_HASH_SALT: "s" } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use("*", sameOriginWrites);
  app.route("/api", publicRoutes);
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => undefined } as unknown as ExecutionContext;
  // as browsers send them: no Origin header, application/reports+json
  const send = async (reports: unknown) => {
    const res = await app.request("http://shop.test/api/nel", { method: "POST", headers: { "Content-Type": "application/reports+json" }, body: JSON.stringify(reports) }, env, ctx);
    await Promise.all(waits);
    return res;
  };
  const errors = () => db.sqlite.prepare("SELECT source, message, url FROM error_events").all();
  return { send, errors };
}

describe("network error reports", () => {
  it("a failed page load is recorded, without its query", async () => {
    const { send, errors } = setup();
    const res = await send([
      { type: "network-error", url: "https://henineboutique.com/fr/merci?c=HN-ABC123", body: { type: "tcp.timed_out", phase: "connection", status_code: 0 } },
      { type: "network-error", url: "https://henineboutique.com/", body: { type: "ok", phase: "application", status_code: 200 } },
    ]);
    expect(res.status).toBe(204);
    expect(errors()).toEqual([{ source: "network", message: "tcp.timed_out (connection) /fr/merci", url: "/fr/merci" }]);
  });

  it("anything else is ignored", async () => {
    const { send, errors } = setup();
    expect((await send({ not: "a list" })).status).toBe(204);
    expect((await send([{ type: "csp-violation", url: "https://x/", body: {} }])).status).toBe(204);
    expect(errors()).toEqual([]);
  });
});
