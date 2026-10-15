/**
 * Store requests have a size cap (audit SEC-4): an oversized form is refused (413) before it is
 * read; a normal one goes through; a review keeps room for its photos.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { HttpError } from "../lib/http";
import { seedShop, testDb } from "../test/db";
import { publicRoutes } from "./public";

function setup() {
  const db = testDb();
  seedShop(db);
  const env = { DB: db, IP_HASH_SALT: "s", RL_BEACON: { limit: async () => ({ success: true }) } } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.route("/", publicRoutes);
  app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.code }, err.status) : c.json({ error: "internal_error" }, 500)));
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const post = (path: string, body: string, type = "application/json") => app.request(path, { method: "POST", headers: { "Content-Type": type }, body }, env, ctx);
  return { post };
}

describe("request size cap", () => {
  it("a 100 KB form is refused before being read", async () => {
    const res = await setup().post("/log", JSON.stringify({ message: "x".repeat(100 * 1024), url: "/" }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body_too_large" });
  });

  it("a normal one goes through", async () => {
    expect((await setup().post("/log", JSON.stringify({ message: "boom", url: "/" }))).status).toBe(200);
  });

  it("a review may carry photos (1 MB is not refused for its size)", async () => {
    const res = await setup().post("/reviews", "x".repeat(1024 * 1024), "multipart/form-data; boundary=zz");
    expect(res.status).not.toBe(413);
  });

  it("admin uploads (fonts, videos) are not capped: they are mounted before the store routes", async () => {
    const admin = new Hono<AppEnv>();
    admin.post("/design/video", async (c) => c.json({ size: (await c.req.arrayBuffer()).byteLength }));
    const api = new Hono<AppEnv>();
    api.route("/admin", admin);
    api.route("/", publicRoutes);
    const res = await api.request("/admin/design/video", { method: "POST", body: "x".repeat(2 * 1024 * 1024) }, {} as Env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: 2 * 1024 * 1024 });
  });
});
