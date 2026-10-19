/**
 * Admin → Produits: categories (tree) and size guides.
 */
import { Hono } from "hono";
import { z } from "zod";
import { slugify } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";
import { optText, text } from "./catalog-shared";

export const categoryRoutes = new Hono<AppEnv>();

/* ───────────── Size guides ───────────── */

interface SizeGuideRow {
  id: number;
  name: string;
  table: string;
  tips_fr: string | null;
  tips_ar: string | null;
}

const sizeGuideOut = (r: SizeGuideRow & { product_count?: number }) => {
  const t = JSON.parse(r.table) as { headers: string[]; headersAr?: string[]; rows: string[][] };
  return { id: r.id, name: r.name, headersFr: t.headers, headersAr: t.headersAr ?? t.headers, rows: t.rows, tipsFr: r.tips_fr, tipsAr: r.tips_ar, productCount: r.product_count ?? 0 };
};

categoryRoutes.get("/size-guides", requirePermission("products.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT g.*, (SELECT COUNT(*) FROM products p WHERE p.size_guide_id = g.id) AS product_count FROM size_guides g ORDER BY g.name",
  ).all<SizeGuideRow & { product_count: number }>();
  return c.json(results.map(sizeGuideOut));
});

const cell = z.string().trim().max(40);
const sizeGuideInput = z
  .object({
    name: text(60).min(2),
    headersFr: z.array(cell.min(1)).min(2).max(8),
    headersAr: z.array(cell).max(8),
    rows: z.array(z.array(cell)).min(1).max(30),
    tipsFr: optText(600),
    tipsAr: optText(600),
  })
  .refine((g) => g.rows.every((r) => r.length === g.headersFr.length) && g.headersAr.length === g.headersFr.length, "columns_mismatch");

function sizeGuideStmt(env: AppEnv["Bindings"], id: number | null, g: z.infer<typeof sizeGuideInput>) {
  const table = JSON.stringify({ headers: g.headersFr, headersAr: g.headersAr.map((h, i) => h || g.headersFr[i]!), rows: g.rows });
  return id
    ? env.DB.prepare("UPDATE size_guides SET name = ?, \"table\" = ?, tips_fr = ?, tips_ar = ? WHERE id = ?").bind(g.name, table, g.tipsFr ?? null, g.tipsAr ?? null, id)
    : env.DB.prepare("INSERT INTO size_guides (name, \"table\", tips_fr, tips_ar) VALUES (?, ?, ?, ?) RETURNING id").bind(g.name, table, g.tipsFr ?? null, g.tipsAr ?? null);
}

categoryRoutes.post("/size-guides", requirePermission("products.edit"), async (c) => {
  const input = await body(c, sizeGuideInput);
  const row = await sizeGuideStmt(c.env, null, input).first<{ id: number }>();
  await auditStmt(c.env, actorOf(c.get("member")), "create", "size_guide", row!.id).run();
  return c.json({ id: row!.id }, 201);
});

categoryRoutes.put("/size-guides/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, sizeGuideInput);
  await c.env.DB.batch([sizeGuideStmt(c.env, id, input), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "size_guide", id)]);
  return c.json({ ok: true });
});

categoryRoutes.delete("/size-guides/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE products SET size_guide_id = NULL WHERE size_guide_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM size_guides WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "size_guide", id),
  ]);
  return c.json({ ok: true });
});
/* ───────────── Categories ───────────── */

categoryRoutes.get("/categories", requirePermission("products.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status != 'archived') AS product_count
       FROM categories c ORDER BY c.sort, c.id`,
  ).all();
  return c.json(results);
});

const categoryInput = z.object({
  nameFr: text(60).min(2),
  nameAr: text(60),
  slug: text(60).optional(),
  descriptionFr: optText(500),
  descriptionAr: optText(500),
  sort: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  /** sub-category of a main category (two levels only) */
  parentId: z.number().int().positive().nullable().default(null),
  season: z.enum(["summer", "winter"]).nullable().default(null),
});

/** A parent must be a main category (not itself, not a sub-category); a category with sub-categories stays main. */
async function checkParent(env: AppEnv["Bindings"], id: number | null, parentId: number | null) {
  if (parentId == null) return;
  if (parentId === id) throw new HttpError(422, "validation_failed", { parentId: "self" });
  const p = await env.DB.prepare("SELECT parent_id FROM categories WHERE id = ?").bind(parentId).first<{ parent_id: number | null }>();
  if (!p) throw new HttpError(422, "validation_failed", { parentId: "unknown" });
  if (p.parent_id != null) throw new HttpError(422, "validation_failed", { parentId: "two_levels" });
  if (id != null) {
    const kids = await env.DB.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").bind(id).first<{ n: number }>();
    if (kids?.n) throw new HttpError(422, "validation_failed", { parentId: "has_subcategories" });
  }
}

categoryRoutes.post("/categories", requirePermission("content.edit"), async (c) => {
  const input = await body(c, categoryInput);
  const slug = slugify(input.slug || input.nameFr);
  await checkParent(c.env, null, input.parentId);
  try {
    const row = await c.env.DB.prepare(
      "INSERT INTO categories (slug, name_fr, name_ar, description_fr, description_ar, sort, is_active, parent_id, season, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(
        slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr ?? null, input.descriptionAr ?? null, input.sort, input.isActive ? 1 : 0,
        input.parentId, input.season, Date.now(),
      )
      .first<{ id: number }>();
    await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "create", "category", row!.id, { slug })]);
    return c.json({ id: row!.id }, 201);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
});

categoryRoutes.put("/categories/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, categoryInput);
  await checkParent(c.env, id, input.parentId);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE categories SET slug = ?, name_fr = ?, name_ar = ?, description_fr = ?, description_ar = ?, sort = ?, is_active = ?, parent_id = ?, season = ?, updated_at = ? WHERE id = ?",
      ).bind(
        slugify(input.slug || input.nameFr), input.nameFr, input.nameAr || input.nameFr, input.descriptionFr ?? null, input.descriptionAr ?? null, input.sort,
        input.isActive ? 1 : 0, input.parentId, input.season, Date.now(), id,
      ),
      bumpCatalogStmt(c.env),
      auditStmt(c.env, actorOf(c.get("member")), "update", "category", id),
    ]);
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "slug_taken");
    throw err;
  }
  return c.json({ ok: true });
});

categoryRoutes.delete("/categories/:id", requirePermission("content.edit"), async (c) => {
  const id = intParam(c, "id");
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?").bind(id).first<{ n: number }>();
  if (used?.n) throw new HttpError(409, "category_not_empty", { products: used.n });
  const kids = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").bind(id).first<{ n: number }>();
  if (kids?.n) throw new HttpError(409, "category_not_empty", { subcategories: kids.n });
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "category", id),
  ]);
  return c.json({ ok: true });
});
