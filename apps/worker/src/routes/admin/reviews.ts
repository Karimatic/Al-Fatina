/**
 * Admin → Avis: moderation, reviews added by the team, review settings.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { reviewPhotos } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt, getSettings, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const reviewRoutes = new Hono<AppEnv>();

/* ───────────── Avis ───────────── */

reviewRoutes.get("/reviews", requirePermission("reviews.moderate"), async (c) => {
  const status = c.req.query("status") ?? "pending";
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT r.*, p.name_fr AS product, p.slug FROM reviews r JOIN products p ON p.id = r.product_id
        ${status === "all" ? "" : "WHERE r.status = ?"} ORDER BY r.created_at DESC LIMIT 100`,
    ).bind(...(status === "all" ? [] : [status])),
    c.env.DB.prepare("SELECT status, COUNT(*) AS n, AVG(rating) AS avg FROM reviews GROUP BY status"),
  ]);
  return c.json({
    rows: (rows!.results as (Record<string, unknown> & { photos: string | null })[]).map((r) => ({ ...r, photo_urls: reviewPhotos(c.env, r.photos) })),
    counts: counts!.results,
  });
});

/**
 * A review received elsewhere (Instagram, WhatsApp, in the shop), typed in by the team.
 * It is never marked "verified purchase": that badge stays for customers with a delivered order.
 */
reviewRoutes.post("/reviews", requirePermission("reviews.moderate"), async (c) => {
  const input = await body(
    c,
    z.object({
      productId: z.number().int().positive(),
      name: cleanText(60).pipe(z.string().min(2)),
      rating: z.number().int().min(1).max(5),
      text: cleanText(1000).nullable().optional(),
      createdAt: z.number().int().positive().max(Date.now() + 60_000).optional(),
      status: z.enum(["approved", "pending"]).default("approved"),
    }),
  );
  const product = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(input.productId).first();
  if (!product) throw new HttpError(404, "not_found");
  const row = await c.env.DB.prepare(
    "INSERT INTO reviews (product_id, order_id, name, rating, text, verified, status, created_at) VALUES (?, NULL, ?, ?, ?, 0, ?, ?) RETURNING id",
  )
    .bind(input.productId, input.name, input.rating, input.text || null, input.status, input.createdAt ?? Date.now())
    .first<{ id: number }>();
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "review", row!.id, { productId: input.productId })]);
  return c.json({ id: row!.id }, 201);
});

reviewRoutes.patch("/reviews/:id", requirePermission("reviews.moderate"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
      reply: cleanText(1000).nullable().optional(),
      isFeatured: z.boolean().optional(),
      // wording: only for reviews added by the team (a customer's verified review is never rewritten)
      name: cleanText(60).pipe(z.string().min(2)).optional(),
      rating: z.number().int().min(1).max(5).optional(),
      text: cleanText(1000).nullable().optional(),
      productId: z.number().int().positive().optional(),
    }),
  );
  const wording = input.name != null || input.rating != null || "text" in input || input.productId != null;
  if (wording) {
    const r = await c.env.DB.prepare("SELECT verified FROM reviews WHERE id = ?").bind(id).first<{ verified: number }>();
    if (!r) throw new HttpError(404, "not_found");
    if (r.verified) throw new HttpError(409, "verified_review_locked");
    await c.env.DB.prepare(
      "UPDATE reviews SET name = COALESCE(?, name), rating = COALESCE(?, rating), text = CASE WHEN ? THEN ? ELSE text END, product_id = COALESCE(?, product_id) WHERE id = ? AND verified = 0",
    )
      .bind(input.name ?? null, input.rating ?? null, "text" in input ? 1 : 0, input.text || null, input.productId ?? null, id)
      .run();
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE reviews SET status = COALESCE(?, status), reply = CASE WHEN ? THEN ? ELSE reply END, is_featured = COALESCE(?, is_featured) WHERE id = ?",
    ).bind(input.status ?? null, "reply" in input ? 1 : 0, input.reply ?? null, input.isFeatured == null ? null : input.isFeatured ? 1 : 0, id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "moderate", "review", id, input),
  ]);
  return c.json({ ok: true });
});

reviewRoutes.delete("/reviews/:id", requirePermission("reviews.moderate"), async (c) => {
  const id = intParam(c, "id");
  const row = await c.env.DB.prepare("SELECT photos FROM reviews WHERE id = ?").bind(id).first<{ photos: string | null }>();
  const keys = (JSON.parse(row?.photos ?? "[]") as string[]).filter((k) => typeof k === "string");
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys).catch(() => undefined));
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM reviews WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "review", id)]);
  return c.json({ ok: true });
});

/* ───────────── Avis: settings ───────────── */

reviewRoutes.get("/reviews/settings", requirePermission("reviews.moderate"), async (c) => c.json((await getSettings(c.env, ["reviews"])).reviews));

reviewRoutes.put("/reviews/settings", requirePermission("reviews.moderate"), async (c) => {
  const input = await body(c, z.object({ auto_approve_verified: z.boolean() }));
  await c.env.DB.batch([setSettingStmt(c.env, "reviews", input), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "reviews", input)]);
  return c.json(input);
});
