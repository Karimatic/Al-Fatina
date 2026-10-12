/**
 * Admin → Liens: the link-in-bio page and short links.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, isSafeLink, slugify } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const linkRoutes = new Hono<AppEnv>();

/* ───────────── Liens: link in bio + short links ───────────── */

linkRoutes.get("/links", requirePermission("marketing.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM links ORDER BY kind, sort, id").all();
  return c.json(results);
});

const linkInput = z.object({
  kind: z.enum(["bio", "short"]),
  slug: z.string().trim().max(40).nullable().optional(),
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
  const slug = input.kind === "short" ? slugify(input.slug || "") : null;
  if (input.kind === "short" && !slug) throw new HttpError(422, "slug_required");
  const vals = [input.kind, slug, input.labelFr ?? null, input.labelAr ?? null, input.target, input.icon ?? null, input.sort, input.isActive ? 1 : 0];
  try {
    if (id) await c.env.DB.prepare("UPDATE links SET kind = ?, slug = ?, label_fr = ?, label_ar = ?, target = ?, icon = ?, sort = ?, is_active = ? WHERE id = ?").bind(...vals, id).run();
    else {
      const row = await c.env.DB.prepare("INSERT INTO links (kind, slug, label_fr, label_ar, target, icon, sort, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(...vals, Date.now())
        .first<{ id: number }>();
      id = row!.id;
    }
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "save", "link", id)]);
  return c.json({ id });
}

linkRoutes.post("/links", requirePermission("marketing.edit"), (c) => saveLink(c, null));
linkRoutes.put("/links/:id", requirePermission("marketing.edit"), (c) => saveLink(c, intParam(c, "id")));
linkRoutes.delete("/links/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM links WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "link", id)]);
  return c.json({ ok: true });
});
