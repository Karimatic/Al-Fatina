/**
 * Admin → Liens: the link-in-bio page and short links.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, isSafeLink } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const linkRoutes = new Hono<AppEnv>();

/* ───────────── Liens: the bio page's links ───────────── */

linkRoutes.get("/links", requirePermission("marketing.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM links WHERE kind = 'bio' ORDER BY sort, id").all();
  return c.json(results);
});

const linkInput = z.object({
  labelFr: cleanText(80).nullable().optional(),
  labelAr: cleanText(80).nullable().optional(),
  target: z
    .string()
    .trim()
    .max(500)
    .refine(isSafeLink, "target_invalid"),
  icon: z.string().trim().max(20).nullable().optional(),
  sort: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

async function saveLink(c: Parameters<typeof body>[0], id: number | null) {
  const input = await body(c, linkInput);
  const vals = [input.labelFr ?? null, input.labelAr ?? null, input.target, input.icon ?? null, input.sort, input.isActive ? 1 : 0];
  if (id) {
    const res = await c.env.DB.prepare("UPDATE links SET label_fr = ?, label_ar = ?, target = ?, icon = ?, sort = ?, is_active = ? WHERE id = ? AND kind = 'bio'").bind(...vals, id).run();
    if (!res.meta.changes) throw new HttpError(404, "not_found");
  } else {
    const row = await c.env.DB.prepare("INSERT INTO links (kind, slug, label_fr, label_ar, target, icon, sort, is_active, created_at) VALUES ('bio', NULL, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(...vals, Date.now())
      .first<{ id: number }>();
    id = row!.id;
  }
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "save", "link", id)]);
  return c.json({ id });
}

linkRoutes.post("/links", requirePermission("marketing.edit"), (c) => saveLink(c, null));
/** The order of the bio page (dragged in Admin → Liens): the ids in their new order. */
linkRoutes.put("/links/order", requirePermission("marketing.edit"), async (c) => {
  const { ids } = await body(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }));
  await c.env.DB.batch([
    ...ids.map((id, i) => c.env.DB.prepare("UPDATE links SET sort = ? WHERE id = ? AND kind = 'bio'").bind(i, id)),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "reorder", "link", null),
  ]);
  return c.json({ ok: true });
});
linkRoutes.put("/links/:id", requirePermission("marketing.edit"), (c) => saveLink(c, intParam(c, "id")));
linkRoutes.delete("/links/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM links WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "link", id)]);
  return c.json({ ok: true });
});
