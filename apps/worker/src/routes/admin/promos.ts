/**
 * Admin → Promos: coupons (and influencer codes), flash sales, collections and drops.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, slugify } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { parseFlashConfig } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt, getSettings, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const promoRoutes = new Hono<AppEnv>();

/* ───────────── Promos: coupons ───────────── */

const couponInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "code_format"),
  type: z.enum(["percent", "fixed", "free_shipping"]),
  value: z.number().int().min(0).max(1_000_000),
  minSubtotal: z.number().int().min(0).nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  firstOrderOnly: z.boolean().default(false),
  startsAt: z.number().int().nullable().optional(),
  endsAt: z.number().int().nullable().optional(),
  isActive: z.boolean().default(true),
  influencerName: cleanText(60).nullable().optional(),
  commissionPct: z.number().int().min(0).max(100).nullable().optional(),
  /** only these products / categories get the discount (empty = the whole cart) */
  appliesTo: z
    .object({ productIds: z.array(z.number().int().positive()).max(200).default([]), categoryIds: z.array(z.number().int().positive()).max(50).default([]) })
    .nullable()
    .optional(),
});

promoRoutes.get("/coupons", requirePermission("promos.edit"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cp.*,
            (SELECT COUNT(*) FROM orders o WHERE o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse')) AS orders,
            (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse')) AS revenue,
            (SELECT COALESCE(SUM(o.discount_total), 0) FROM orders o WHERE o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse')) AS discounted
       FROM coupons cp ORDER BY cp.is_active DESC, cp.created_at DESC`,
  ).all();
  const { checkout } = await getSettings(c.env, ["checkout"]);
  return c.json({ coupons: results, freeShippingOver: checkout.free_shipping_over });
});

/**
 * Influencer report for a period: what each one's codes brought. The commission is due on
 * delivered orders only, on the items (after discount, delivery excluded).
 */
promoRoutes.get("/influencers", requirePermission("promos.edit"), async (c) => {
  const from = Number(c.req.query("from") ?? 0) || 0;
  const to = Number(c.req.query("to") ?? 0) || Date.now() + 1;
  const { results } = await c.env.DB.prepare(
    `SELECT cp.influencer_name AS name, cp.code, COALESCE(cp.commission_pct, 0) AS pct,
            COUNT(o.id) AS orders,
            SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
            SUM(CASE WHEN o.status IN ('nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison') THEN 1 ELSE 0 END) AS pending,
            COALESCE(SUM(CASE WHEN o.status = 'livree' THEN o.subtotal - o.discount_total ELSE 0 END), 0) AS delivered_sales,
            COALESCE(SUM(CASE WHEN o.status IN ('nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison') THEN o.subtotal - o.discount_total ELSE 0 END), 0) AS pending_sales,
            SUM(CASE WHEN o.id = (SELECT MIN(o2.id) FROM orders o2 WHERE o2.customer_id = o.customer_id) THEN 1 ELSE 0 END) AS new_customers
       FROM coupons cp
       LEFT JOIN orders o ON o.coupon_code = cp.code AND o.status NOT IN ('annulee','doublon','fausse') AND o.created_at >= ? AND o.created_at < ?
      WHERE cp.influencer_name IS NOT NULL AND cp.influencer_name != ''
      GROUP BY cp.id
      ORDER BY cp.influencer_name, cp.code`,
  )
    .bind(from, to)
    .all<{
      name: string; code: string; pct: number; orders: number; delivered: number | null; returned: number | null; pending: number | null;
      delivered_sales: number; pending_sales: number; new_customers: number | null;
    }>();
  const people = new Map<string, {
    name: string; codes: string[]; orders: number; delivered: number; returned: number; pending: number; newCustomers: number;
    deliveredSales: number; pendingSales: number; commission: number; pendingCommission: number;
  }>();
  for (const r of results) {
    const key = r.name.trim().toLowerCase();
    const p = people.get(key) ?? {
      name: r.name.trim(), codes: [], orders: 0, delivered: 0, returned: 0, pending: 0, newCustomers: 0, deliveredSales: 0, pendingSales: 0, commission: 0, pendingCommission: 0,
    };
    p.codes.push(r.pct ? `${r.code} (${r.pct} %)` : r.code);
    p.orders += r.orders;
    p.delivered += r.delivered ?? 0;
    p.returned += r.returned ?? 0;
    p.pending += r.pending ?? 0;
    p.newCustomers += r.new_customers ?? 0;
    p.deliveredSales += r.delivered_sales;
    p.pendingSales += r.pending_sales;
    p.commission += Math.round((r.delivered_sales * r.pct) / 100);
    p.pendingCommission += Math.round((r.pending_sales * r.pct) / 100);
    people.set(key, p);
  }
  return c.json([...people.values()].sort((a, b) => b.deliveredSales - a.deliveredSales));
});

async function saveCoupon(c: Parameters<typeof body>[0], id: number | null) {
  const input = await body(c, couponInput);
  if (input.type === "percent" && input.value > 100) throw new HttpError(422, "percent_over_100");
  const scope = input.appliesTo && (input.appliesTo.productIds.length || input.appliesTo.categoryIds.length) ? JSON.stringify(input.appliesTo) : null;
  const vals = [
    input.code, input.type, input.value, input.minSubtotal ?? null, input.usageLimit ?? null, input.perCustomerLimit ?? null,
    input.firstOrderOnly ? 1 : 0, input.startsAt ?? null, input.endsAt ?? null, input.isActive ? 1 : 0, input.influencerName ?? null, input.commissionPct ?? null,
    scope,
  ];
  try {
    if (id) {
      await c.env.DB.prepare(
        `UPDATE coupons SET code = ?, type = ?, value = ?, min_subtotal = ?, usage_limit = ?, per_customer_limit = ?, first_order_only = ?,
           starts_at = ?, ends_at = ?, is_active = ?, influencer_name = ?, commission_pct = ?, applies_to = ? WHERE id = ?`,
      )
        .bind(...vals, id)
        .run();
    } else {
      const row = await c.env.DB.prepare(
        `INSERT INTO coupons (code, type, value, min_subtotal, usage_limit, per_customer_limit, first_order_only, starts_at, ends_at, is_active,
           influencer_name, commission_pct, applies_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
        .bind(...vals, Date.now())
        .first<{ id: number }>();
      id = row!.id;
    }
  } catch (err) {
    const msg = String((err as Error).message);
    if (msg.includes("UNIQUE")) throw new HttpError(409, "code_taken");
    if (msg.includes("coupons_usage_ok")) throw new HttpError(409, "limit_below_used");
    throw err;
  }
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "save", "coupon", id, { code: input.code })]);
  return c.json({ id });
}

promoRoutes.post("/coupons", requirePermission("promos.edit"), (c) => saveCoupon(c, null));
promoRoutes.put("/coupons/:id", requirePermission("promos.edit"), (c) => saveCoupon(c, intParam(c, "id")));
promoRoutes.delete("/coupons/:id", requirePermission("promos.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM coupons WHERE id = ?").bind(id), auditStmt(c.env, actorOf(c.get("member")), "delete", "coupon", id)]);
  return c.json({ ok: true });
});

/* ───────────── Collections & drops ───────────── */

const collectionInput = z.object({
  slug: z.string().trim().max(80).optional(),
  nameFr: cleanText(80).pipe(z.string().min(2)),
  nameAr: cleanText(80),
  descriptionFr: cleanText(1000).nullable().optional(),
  descriptionAr: cleanText(1000).nullable().optional(),
  startsAt: z.number().int().positive().nullable(),
  endsAt: z.number().int().positive().nullable(),
  showCountdown: z.boolean().default(true),
  lockProducts: z.boolean().default(false),
  isActive: z.boolean(),
  productIds: z.array(z.number().int().positive()).max(100),
});

/**
 * Public caches are keyed on how many of these instants have passed, so a drop's products
 * appear (and the countdown turns into the collection) the moment it starts, with no cron.
 */
/** Start/end times of drops and flash sales: public cache keys change as each one passes. */
async function dropTimesStmt(env: AppEnv["Bindings"]) {
  const { results } = await env.DB.prepare(
    `SELECT starts_at, ends_at FROM collections WHERE is_active = 1 AND (starts_at IS NOT NULL OR ends_at IS NOT NULL)
     UNION ALL SELECT starts_at, ends_at FROM promotions WHERE kind = 'flash_sale' AND is_active = 1`,
  ).all<{ starts_at: number | null; ends_at: number | null }>();
  const times = results.flatMap((r) => [r.starts_at, r.ends_at]).filter((t): t is number => t != null).sort((a, b) => a - b);
  return setSettingStmt(env, "drop_times", times);
}

promoRoutes.get("/collections", requirePermission("marketing.edit"), async (c) => {
  const [cols, items] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM collections ORDER BY is_active DESC, COALESCE(starts_at, created_at) DESC, id DESC"),
    c.env.DB.prepare("SELECT collection_id, product_id FROM collection_products ORDER BY collection_id, sort"),
  ]);
  const byCol = new Map<number, number[]>();
  for (const r of items!.results as { collection_id: number; product_id: number }[]) byCol.set(r.collection_id, [...(byCol.get(r.collection_id) ?? []), r.product_id]);
  return c.json((cols!.results as { id: number }[]).map((r) => ({ ...r, product_ids: byCol.get(r.id) ?? [] })));
});

async function saveCollection(c: Parameters<typeof body>[0], id: number | null) {
  const input = await body(c, collectionInput);
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw new HttpError(422, "ends_before_start");
  const slug = slugify(input.slug || input.nameFr);
  if (!slug) throw new HttpError(422, "slug_required");
  const taken = await c.env.DB.prepare("SELECT id FROM collections WHERE slug = ? AND id != ?").bind(slug, id ?? 0).first();
  if (taken) throw new HttpError(409, "slug_taken");
  const cols = [slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr ?? null, input.descriptionAr ?? null, input.startsAt, input.endsAt,
    input.showCountdown ? 1 : 0, input.lockProducts ? 1 : 0, input.isActive ? 1 : 0];
  let collectionId = id;
  if (id) {
    const res = await c.env.DB.prepare(
      `UPDATE collections SET slug = ?, name_fr = ?, name_ar = ?, description_fr = ?, description_ar = ?, starts_at = ?, ends_at = ?,
         show_countdown = ?, lock_products = ?, is_active = ? WHERE id = ?`,
    )
      .bind(...cols, id)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "not_found");
  } else {
    const row = await c.env.DB.prepare(
      `INSERT INTO collections (slug, name_fr, name_ar, description_fr, description_ar, starts_at, ends_at, show_countdown, lock_products, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(...cols, Date.now())
      .first<{ id: number }>();
    collectionId = row!.id;
  }
  const productIds = [...new Set(input.productIds)];
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM collection_products WHERE collection_id = ?").bind(collectionId),
    ...productIds.map((pid, i) =>
      c.env.DB.prepare("INSERT INTO collection_products (collection_id, product_id, sort) SELECT ?, id, ? FROM products WHERE id = ?").bind(collectionId, i, pid),
    ),
    await dropTimesStmt(c.env),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), id ? "update" : "create", "collection", collectionId, { name: input.nameFr, products: productIds.length }),
  ]);
  return c.json({ id: collectionId, slug }, id ? 200 : 201);
}

promoRoutes.post("/collections", requirePermission("marketing.edit"), (c) => saveCollection(c, null));
promoRoutes.put("/collections/:id", requirePermission("marketing.edit"), (c) => saveCollection(c, intParam(c, "id")));

promoRoutes.delete("/collections/:id", requirePermission("marketing.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM collection_products WHERE collection_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id),
  ]);
  await c.env.DB.batch([await dropTimesStmt(c.env), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "collection", id)]);
  return c.json({ ok: true });
});

/* ───────────── Ventes flash ───────────── */

const flashInput = z
  .object({
    nameFr: cleanText(60).pipe(z.string().min(2)),
    nameAr: cleanText(60).pipe(z.string().min(2)),
    percent: z.number().int().min(1).max(90),
    productIds: z.array(z.number().int().positive()).min(1).max(100),
    limit: z.number().int().min(1).max(10_000).nullable().default(null),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    isActive: z.boolean().default(true),
  })
  .refine((f) => f.endsAt > f.startsAt, { message: "ends_before_start", path: ["endsAt"] });

promoRoutes.get("/flash-sales", requirePermission("promos.edit"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM promotions WHERE kind = 'flash_sale' ORDER BY is_active DESC, ends_at DESC").all<{
    id: number; name: string; config: string; starts_at: number; ends_at: number; is_active: number;
  }>();
  // pieces sold during each sale, at its products
  const sold = results.length
    ? await c.env.DB.batch(
        results.map((r) => {
          const ids = parseFlashConfig(r.config).productIds;
          return c.env.DB.prepare(
            `SELECT COALESCE(SUM(oi.qty), 0) AS units, COALESCE(SUM(oi.qty * oi.unit_price), 0) AS sales FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ('annulee','doublon','fausse') AND oi.product_id IN (${ids.length ? ids.join(",") : "0"})`,
          ).bind(r.starts_at, r.ends_at);
        }),
      )
    : [];
  return c.json(
    results.map((r, i) => {
      const [nameFr, nameAr] = r.name.split(" | ");
      const cfg = parseFlashConfig(r.config);
      const s = (sold[i]?.results[0] ?? { units: 0, sales: 0 }) as { units: number; sales: number };
      return { id: r.id, nameFr, nameAr: nameAr ?? nameFr, ...cfg, startsAt: r.starts_at, endsAt: r.ends_at, isActive: !!r.is_active, units: s.units, sales: s.sales };
    }),
  );
});

async function saveFlash(c: Parameters<typeof body>[0], id: number | null) {
  const f = await body(c, flashInput);
  const name = `${f.nameFr.replace(/\|/g, "/")} | ${f.nameAr.replace(/\|/g, "/")}`;
  const config = JSON.stringify({ productIds: [...new Set(f.productIds)], percent: f.percent, limit: f.limit });
  if (id) {
    const res = await c.env.DB.prepare("UPDATE promotions SET name = ?, config = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ? AND kind = 'flash_sale'")
      .bind(name, config, f.startsAt, f.endsAt, f.isActive ? 1 : 0, id)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "not_found");
  } else {
    const row = await c.env.DB.prepare(
      "INSERT INTO promotions (name, kind, config, priority, stackable, starts_at, ends_at, is_active) VALUES (?, 'flash_sale', ?, 0, 0, ?, ?, ?) RETURNING id",
    )
      .bind(name, config, f.startsAt, f.endsAt, f.isActive ? 1 : 0)
      .first<{ id: number }>();
    id = row!.id;
  }
  await c.env.DB.batch([await dropTimesStmt(c.env), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "save", "flash_sale", id, { name: f.nameFr, percent: f.percent })]);
  return c.json({ id });
}

promoRoutes.post("/flash-sales", requirePermission("promos.edit"), (c) => saveFlash(c, null));
promoRoutes.put("/flash-sales/:id", requirePermission("promos.edit"), (c) => saveFlash(c, intParam(c, "id")));
promoRoutes.delete("/flash-sales/:id", requirePermission("promos.edit"), async (c) => {
  const id = intParam(c, "id");
  await c.env.DB.prepare("DELETE FROM promotions WHERE id = ? AND kind = 'flash_sale'").bind(id).run();
  await c.env.DB.batch([await dropTimesStmt(c.env), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "delete", "flash_sale", id)]);
  return c.json({ ok: true });
});
