/**
 * Admin → Stock: levels, per-product view, batch and single adjustments (restock alerts and
 * pushes when a size comes back), movement history.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { mediaUrl, variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { notifyRestocked } from "../../lib/telegram";
import { sendRestockPushes } from "../../lib/webpush";
import { actorOf, requirePermission } from "../../middleware/access";
import { canSeeCost, optText } from "./catalog-shared";

export const stockRoutes = new Hono<AppEnv>();

/* ───────────── Stock ───────────── */

stockRoutes.get("/stock", requirePermission("stock.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const filter = c.req.query("filter") ?? "all";
  const where = ["v.is_active = 1", "p.status != 'archived'"];
  const binds: unknown[] = [];
  if (q) {
    where.push("(p.name_fr LIKE ? OR v.sku LIKE ? OR v.barcode = ?)");
    binds.push(`%${q}%`, `%${q}%`, q);
  }
  if (filter === "low") where.push("v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold AND v.stock_on_hand - v.stock_reserved > 0");
  if (filter === "out") where.push("v.stock_on_hand - v.stock_reserved <= 0");
  if (filter === "waiting") where.push("EXISTS (SELECT 1 FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL)");
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.sku, v.barcode, v.stock_on_hand, v.stock_reserved, v.low_stock_threshold, v.updated_at,
            p.id AS product_id, p.name_fr, p.cost_price, COALESCE(v.price_override, p.price) AS price,
            (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE ${where.join(" AND ")}
      ORDER BY (v.stock_on_hand - v.stock_reserved) ASC, p.name_fr LIMIT 500`,
  )
    .bind(...binds)
    .all<{ id: number } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, results.map((r) => r.id));
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(v.stock_on_hand), 0) AS units, COALESCE(SUM(v.stock_on_hand * COALESCE(p.cost_price, 0)), 0) AS cost_value,
            COALESCE(SUM(v.stock_on_hand * COALESCE(v.price_override, p.price)), 0) AS retail_value,
            SUM(CASE WHEN v.stock_on_hand - v.stock_reserved <= 0 THEN 1 ELSE 0 END) AS out_count,
            SUM(CASE WHEN v.stock_on_hand - v.stock_reserved > 0 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold THEN 1 ELSE 0 END) AS low_count
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.status != 'archived'`,
  ).first();
  const seeCost = canSeeCost(c);
  return c.json({
    totals: seeCost ? totals : { ...totals, cost_value: null },
    rows: results.map((r) => ({ ...r, cost_price: seeCost ? r.cost_price : null, options: labels.get(r.id)?.fr ?? "" })),
  });
});

/**
 * Stock by product: each product with its photo and its size × colour table (one cell per
 * variant). Filters keep a product when at least one of its variants matches.
 */
stockRoutes.get("/stock/products", requirePermission("stock.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const filter = c.req.query("filter") ?? "all";
  const category = Number(c.req.query("category") ?? 0) || null;
  const where = ["p.status != 'archived'"];
  const binds: unknown[] = [];
  if (q) {
    where.push("(p.name_fr LIKE ? OR p.name_ar LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND (v.sku LIKE ? OR v.barcode = ?)))");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (category) {
    where.push("p.category_id = ?");
    binds.push(category);
  }
  const has = (cond: string) => `EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND ${cond})`;
  if (filter === "low") where.push(has("v.stock_on_hand - v.stock_reserved > 0 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold"));
  if (filter === "out") where.push(has("v.stock_on_hand - v.stock_reserved <= 0"));
  if (filter === "waiting") where.push(has("EXISTS (SELECT 1 FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL)"));
  const products = await c.env.DB.prepare(
    `SELECT p.id, p.name_fr, p.name_ar, p.status, p.price, c.name_fr AS category,
            (SELECT base_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_key
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(c.sort, 999), p.name_fr LIMIT 150`,
  )
    .bind(...binds)
    .all<{ id: number; name_fr: string; name_ar: string; status: string; price: number; category: string | null; image_key: string | null }>();
  const ids = products.results.map((p) => p.id);
  if (!ids.length) return c.json({ products: [] });
  const ph = ids.map(() => "?").join(",");
  const [options, values, variants] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, product_id, kind, name_fr FROM product_options WHERE product_id IN (${ph}) ORDER BY product_id, sort, id`).bind(...ids),
    c.env.DB.prepare(
      `SELECT v.id, v.option_id, v.label_fr, v.hex FROM option_values v JOIN product_options o ON o.id = v.option_id WHERE o.product_id IN (${ph}) ORDER BY v.sort, v.id`,
    ).bind(...ids),
    c.env.DB.prepare(
      `SELECT v.id, v.product_id, v.sku, v.option_value_ids, v.stock_on_hand, v.stock_reserved, v.low_stock_threshold, v.is_active,
              (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
         FROM variants v WHERE v.product_id IN (${ph}) ORDER BY v.id`,
    ).bind(...ids),
  ]);
  const opts = options!.results as { id: number; product_id: number; kind: string; name_fr: string }[];
  const vals = values!.results as { id: number; option_id: number; label_fr: string; hex: string | null }[];
  const vars = variants!.results as { id: number; product_id: number; sku: string; option_value_ids: string; stock_on_hand: number; stock_reserved: number; low_stock_threshold: number; is_active: number; waiting: number }[];
  return c.json({
    products: products.results.map((p) => ({
      id: p.id,
      name: p.name_fr,
      nameAr: p.name_ar,
      status: p.status,
      price: p.price,
      category: p.category,
      image: p.image_key ? mediaUrl(c.env, p.image_key).replace("{w}", "480") : null,
      options: opts
        .filter((o) => o.product_id === p.id)
        .map((o) => ({ id: o.id, kind: o.kind, name: o.name_fr, values: vals.filter((v) => v.option_id === o.id).map((v) => ({ id: v.id, label: v.label_fr, hex: v.hex })) })),
      variants: vars
        .filter((v) => v.product_id === p.id)
        .map((v) => ({
          id: v.id, sku: v.sku, valueIds: JSON.parse(v.option_value_ids) as number[], onHand: v.stock_on_hand, reserved: v.stock_reserved,
          low: v.low_stock_threshold, active: !!v.is_active, waiting: v.waiting,
        })),
    })),
  });
});

/**
 * Several stock changes at once: the size × colour table ("set" = counted quantity) or a
 * delivery ("add"). One database batch; each line keeps its history and back-in-stock alerts.
 */
stockRoutes.post("/stock/batch", requirePermission("stock.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      reason: z.enum(["reception", "ajustement", "casse", "retour", "inventaire"]),
      note: optText(200),
      lines: z
        .array(z.object({ variantId: z.number().int().positive(), mode: z.enum(["add", "set"]), qty: z.number().int().min(0).max(100_000) }))
        .min(1)
        .max(300),
    }),
  );
  const ids = [...new Set(input.lines.map((l) => l.variantId))];
  const { results } = await c.env.DB.prepare(`SELECT id, stock_on_hand, stock_reserved FROM variants WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: number; stock_on_hand: number; stock_reserved: number }>();
  const current = new Map(results.map((v) => [v.id, v]));
  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const restocked: number[] = [];
  let pieces = 0;
  const planned = new Map<number, number>(); // several lines on one variant add up
  for (const l of input.lines) {
    const v = current.get(l.variantId);
    if (!v) throw new HttpError(404, "not_found", { variantId: l.variantId });
    const before = planned.get(v.id) ?? v.stock_on_hand;
    const target = l.mode === "set" ? l.qty : before + l.qty;
    if (target < v.stock_reserved) throw new HttpError(409, "stock_below_reserved", { variantId: v.id, reserved: v.stock_reserved });
    planned.set(v.id, target);
  }
  for (const [id, target] of planned) {
    const v = current.get(id)!;
    const delta = target - v.stock_on_hand;
    if (!delta) continue;
    pieces += Math.max(0, delta);
    if (v.stock_on_hand - v.stock_reserved <= 0 && target - v.stock_reserved > 0) restocked.push(id);
    stmts.push(
      c.env.DB.prepare("UPDATE variants SET stock_on_hand = ?, updated_at = ? WHERE id = ? AND stock_on_hand = ?").bind(target, now, id, v.stock_on_hand),
      c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        id, delta, input.reason, input.note ?? null, actor, now,
      ),
    );
  }
  if (!stmts.length) return c.json({ changed: 0, pieces: 0 });
  await c.env.DB.batch([...stmts, bumpCatalogStmt(c.env)]);
  if (restocked.length) {
    c.executionCtx.waitUntil(notifyRestocked(c.env, restocked).catch(() => undefined));
    c.executionCtx.waitUntil(sendRestockPushes(c.env, restocked).catch(() => undefined));
  }
  return c.json({ changed: stmts.length / 2, pieces });
});

stockRoutes.post("/stock/:variantId/adjust", requirePermission("stock.edit"), async (c) => {
  const variantId = intParam(c, "variantId");
  const input = await body(
    c,
    z.object({
      mode: z.enum(["add", "remove", "set"]),
      qty: z.number().int().min(0).max(100_000),
      reason: z.enum(["reception", "ajustement", "casse", "retour", "inventaire"]),
      note: optText(200),
    }),
  );
  const v = await c.env.DB.prepare("SELECT stock_on_hand, stock_reserved FROM variants WHERE id = ?").bind(variantId).first<{ stock_on_hand: number; stock_reserved: number }>();
  if (!v) throw new HttpError(404, "not_found");
  const target = input.mode === "set" ? input.qty : input.mode === "add" ? v.stock_on_hand + input.qty : v.stock_on_hand - input.qty;
  if (target < v.stock_reserved) throw new HttpError(409, "stock_below_reserved", { reserved: v.stock_reserved });
  const delta = target - v.stock_on_hand;
  if (delta === 0) return c.json({ stockOnHand: target });
  const backInStock = v.stock_on_hand - v.stock_reserved <= 0 && target - v.stock_reserved > 0;
  if (backInStock) c.executionCtx.waitUntil(notifyRestocked(c.env, [variantId]).catch(() => undefined));

  const actor = actorOf(c.get("member"));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE variants SET stock_on_hand = ?, updated_at = ? WHERE id = ? AND stock_on_hand = ?").bind(target, Date.now(), variantId, v.stock_on_hand),
    c.env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      variantId, delta, input.reason, input.note ?? null, actor, Date.now(),
    ),
    bumpCatalogStmt(c.env),
  ]);
  // after the update: the push only goes out once the stock is really there
  if (backInStock) c.executionCtx.waitUntil(sendRestockPushes(c.env, [variantId]).catch(() => undefined));
  return c.json({ stockOnHand: target });
});

stockRoutes.get("/stock/movements", requirePermission("stock.view"), async (c) => {
  const variantId = c.req.query("variant");
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.variant_id, m.delta, m.reason, m.note, m.actor, m.created_at, v.sku, p.name_fr, o.public_code
       FROM stock_movements m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
       LEFT JOIN orders o ON o.id = m.order_id
      ${variantId ? "WHERE m.variant_id = ?" : ""} ORDER BY m.id DESC LIMIT 100`,
  )
    .bind(...(variantId ? [Number(variantId)] : []))
    .all();
  return c.json(results);
});
