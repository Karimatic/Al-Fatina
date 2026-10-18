/**
 * A product's video (Admin → Produits → Vidéo): stored, shown on the product page, replaced
 * (the old file deleted), removed; a file that is not a video is refused.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../../env";
import { getProductDetail } from "../../lib/catalog";
import { HttpError } from "../../lib/http";
import { OWNER, seedShop, testDb } from "../../test/db";
import { photoRoutes } from "./photos";

// the first bytes of an MP4 (« ftyp » at byte 4)
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 1, 2, 3, 4]);

function setup() {
  const db = testDb();
  seedShop(db);
  db.sqlite.exec("UPDATE products SET status = 'published' WHERE id = 1");
  const stored = new Map<string, unknown>();
  const deleted: string[] = [];
  const MEDIA = {
    put: async (k: string, v: unknown) => void stored.set(k, v),
    delete: async (k: string | string[]) => void deleted.push(...[k].flat()),
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("member", OWNER);
    await next();
  });
  app.route("/", photoRoutes);
  app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.code }, err.status) : c.json({ error: "internal_error" }, 500)));
  const env = { DB: db, MEDIA, MEDIA_ORIGIN: "" } as unknown as Env;
  const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  // multipart, like the admin's upload
  const post = (bytes: Uint8Array) => {
    const form = new FormData();
    form.append("video", new File([bytes], "piece.mp4", { type: "video/mp4" }));
    return app.request("/products/1/video", { method: "POST", body: form }, env, ctx);
  };
  const remove = () => app.request("/products/1/video", { method: "DELETE" }, env, ctx);
  return { env, stored, deleted, post, remove };
}

describe("product video", () => {
  it("upload, shown on the product page, replace, remove", async () => {
    const { env, stored, deleted, post, remove } = setup();

    const first = await post(MP4);
    expect(first.status).toBe(200);
    const url = ((await first.json()) as { video: string }).video;
    expect(url).toMatch(/^\/media\/products\/video\/1-.+\.mp4$/);
    expect(stored.size).toBe(1);
    expect((await getProductDetail(env, "pyjama"))?.video).toBe(url);

    // replaced: the old file goes
    expect((await post(MP4)).status).toBe(200);
    expect(deleted).toEqual([url.replace("/media/", "")]);

    // removed
    expect((await remove()).status).toBe(200);
    expect((await getProductDetail(env, "pyjama"))?.video).toBeNull();
  });

  it("a file that is not a video is refused", async () => {
    const { post, stored } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    const res = await post(png);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "video_type" });
    expect(stored.size).toBe(0);
  });
});
