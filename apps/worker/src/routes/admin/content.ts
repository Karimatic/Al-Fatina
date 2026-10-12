/**
 * Admin → Contenu: delivery prices (wilayas, communes), pages, store identity.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt, getSetting, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const contentRoutes = new Hono<AppEnv>();

/* ───────────── Contenu: delivery prices, pages, store identity ───────────── */

contentRoutes.get("/content/wilayas", requirePermission("delivery.edit"), async (c) => {
  const [rows, verified] = await Promise.all([
    c.env.DB.prepare(
      "SELECT w.*, (SELECT COUNT(*) FROM communes cm WHERE cm.wilaya_code = w.code) AS communes, (SELECT COUNT(*) FROM orders o WHERE o.wilaya_code = w.code) AS orders FROM wilayas w ORDER BY w.code",
    ).all(),
    getSetting(c.env, "shipping.prices_verified"),
  ]);
  return c.json({ rows: rows.results, verified });
});

const priceField = z.number().int().min(0).max(20000).nullable();
contentRoutes.put("/content/wilayas", requirePermission("delivery.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      codes: z.array(z.number().int().min(1).max(69)).min(1).max(69),
      homePrice: priceField.optional(),
      deskPrice: priceField.optional(),
      delayDays: z.string().trim().max(10).nullable().optional(),
      isActive: z.boolean().optional(),
      markVerified: z.boolean().optional(),
    }),
  );
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("homePrice" in input) {
    sets.push("home_price = ?");
    vals.push(input.homePrice);
  }
  if ("deskPrice" in input) {
    sets.push("desk_price = ?");
    vals.push(input.deskPrice);
  }
  if ("delayDays" in input) {
    sets.push("delay_days = ?");
    vals.push(input.delayDays);
  }
  if ("isActive" in input) {
    sets.push("is_active = ?");
    vals.push(input.isActive ? 1 : 0);
  }
  const stmts: D1PreparedStatement[] = [];
  if (sets.length) {
    stmts.push(c.env.DB.prepare(`UPDATE wilayas SET ${sets.join(", ")}, updated_at = ? WHERE code IN (${input.codes.map(() => "?").join(",")})`).bind(...vals, Date.now(), ...input.codes));
  }
  if (input.markVerified) stmts.push(setSettingStmt(c.env, "shipping.prices_verified", true));
  stmts.push(bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "wilayas", input.codes.join(","), { ...input, codes: undefined }));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/**
 * Communes of a wilaya: home delivery possible or not, and a home price of their own when it
 * differs from the wilaya's (remote communes). Read by the checkout (empty price = the wilaya's).
 */
contentRoutes.get("/content/wilayas/:code/communes", requirePermission("delivery.edit"), async (c) => {
  const code = intParam(c, "code");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name_fr, name_ar, daira_fr, home_price, home_supported, is_active FROM communes WHERE wilaya_code = ? ORDER BY name_fr",
  )
    .bind(code)
    .all();
  return c.json(results);
});

contentRoutes.put("/content/communes", requirePermission("delivery.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      ids: z.array(z.number().int().positive()).min(1).max(200),
      homePrice: priceField.optional(),
      homeSupported: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
  );
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("homePrice" in input) {
    sets.push("home_price = ?");
    vals.push(input.homePrice);
  }
  if ("homeSupported" in input) {
    sets.push("home_supported = ?");
    vals.push(input.homeSupported ? 1 : 0);
  }
  if ("isActive" in input) {
    sets.push("is_active = ?");
    vals.push(input.isActive ? 1 : 0);
  }
  if (!sets.length) throw new HttpError(400, "nothing_to_update");
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE communes SET ${sets.join(", ")} WHERE id IN (${input.ids.map(() => "?").join(",")})`).bind(...vals, ...input.ids),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "communes", input.ids.join(","), { ...input, ids: undefined }),
  ]);
  return c.json({ ok: true });
});

contentRoutes.get("/content/pages", requirePermission("content.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM pages ORDER BY id").all();
  return c.json(results);
});

const pageInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/),
  titleFr: cleanText(120).pipe(z.string().min(2)),
  titleAr: cleanText(120),
  bodyFr: z.string().max(20000),
  bodyAr: z.string().max(20000),
  isActive: z.boolean().default(true),
});

contentRoutes.post("/content/pages", requirePermission("content.edit"), async (c) => {
  const p = await body(c, pageInput);
  try {
    const row = await c.env.DB.prepare("INSERT INTO pages (slug, title_fr, title_ar, body_fr, body_ar, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(p.slug, p.titleFr, p.titleAr || p.titleFr, p.bodyFr, p.bodyAr, p.isActive ? 1 : 0, Date.now())
      .first<{ id: number }>();
    await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "page", row!.id)]);
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
});

contentRoutes.put("/content/pages/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const p = await body(c, pageInput);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pages SET slug = ?, title_fr = ?, title_ar = ?, body_fr = ?, body_ar = ?, is_active = ?, updated_at = ? WHERE id = ?").bind(
      p.slug, p.titleFr, p.titleAr || p.titleFr, p.bodyFr, p.bodyAr, p.isActive ? 1 : 0, Date.now(), id,
    ),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "page", id),
  ]);
  return c.json({ ok: true });
});

contentRoutes.delete("/content/pages/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "page", id)]);
  return c.json({ ok: true });
});

contentRoutes.put("/content/store", requirePermission("content.edit"), async (c) => {
  const input = await body(
    c,
    z.object({ name: cleanText(60).pipe(z.string().min(2)).optional(), season: z.enum(["auto", "summer", "winter"]).optional() }),
  );
  const store = await getSetting(c.env, "store");
  await c.env.DB.batch([setSettingStmt(c.env, "store", { ...store, ...input }), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "store")]);
  return c.json({ ok: true });
});
