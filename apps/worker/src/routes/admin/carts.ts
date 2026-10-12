/**
 * Admin → Paniers: abandoned checkouts (to call back), contacted, deleted.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { variantLabels } from "../../lib/catalog";
import { CANCELLED_SQL } from "../../lib/orders";
import { actorOf, requirePermission } from "../../middleware/access";

export const cartRoutes = new Hono<AppEnv>();

/* ───────────── Paniers (abandoned checkouts) ───────────── */

/** A checkout counts as abandoned after 30 minutes without activity and without an order. */
export const ABANDONED_AFTER = 30 * 60_000;

cartRoutes.get("/carts", requirePermission("carts.view"), async (c) => {
  const filter = c.req.query("filter") ?? "abandoned";
  const now = Date.now();
  const where =
    filter === "recovered"
      ? "ca.recovered_order_id IS NOT NULL"
      : filter === "all"
        ? "1=1"
        : filter === "active"
          ? `ca.recovered_order_id IS NULL AND ca.updated_at >= ${now - ABANDONED_AFTER}`
          : `ca.recovered_order_id IS NULL AND ca.updated_at < ${now - ABANDONED_AFTER}`;
  // a cart counts as recovered when the same phone ordered after the cart was saved
  await c.env.DB.prepare(
    `UPDATE carts SET recovered_order_id = (SELECT o.id FROM orders o WHERE o.phone = carts.phone AND o.created_at >= carts.created_at ORDER BY o.id LIMIT 1)
      WHERE recovered_order_id IS NULL AND phone IS NOT NULL
        AND EXISTS (SELECT 1 FROM orders o WHERE o.phone = carts.phone AND o.created_at >= carts.created_at)`,
  ).run();
  const [rows, stats] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ca.*, w.name_fr AS wilaya, cm.name_fr AS commune, o.public_code AS recovered_code,
              (SELECT COUNT(*) FROM orders x WHERE x.phone = ca.phone AND x.status NOT IN ${CANCELLED_SQL}) AS customer_orders
         FROM carts ca LEFT JOIN wilayas w ON w.code = ca.wilaya_code LEFT JOIN communes cm ON cm.id = ca.commune_id
         LEFT JOIN orders o ON o.id = ca.recovered_order_id
        WHERE ${where} ORDER BY ca.updated_at DESC LIMIT 100`,
    ),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN recovered_order_id IS NOT NULL THEN 1 ELSE 0 END) AS recovered,
              COALESCE(SUM(CASE WHEN recovered_order_id IS NULL THEN value ELSE 0 END), 0) AS lost_value FROM carts WHERE created_at > ?`,
    ).bind(Date.now() - 30 * 86400_000),
  ]);
  const carts = rows!.results as { items: string }[];
  const variantIds = [...new Set(carts.flatMap((ca) => (JSON.parse(ca.items) as { variantId: number }[]).map((i) => i.variantId)))];
  const names = new Map<number, string>();
  if (variantIds.length) {
    const [{ results }, labels] = await Promise.all([
      c.env.DB.prepare(`SELECT v.id, p.name_fr FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${variantIds.map(() => "?").join(",")})`)
        .bind(...variantIds)
        .all<{ id: number; name_fr: string }>(),
      variantLabels(c.env, variantIds),
    ]);
    for (const r of results) names.set(r.id, `${r.name_fr}${labels.get(r.id)?.fr ? ` (${labels.get(r.id)!.fr})` : ""}`);
  }
  return c.json({
    stats: stats!.results[0],
    rows: carts.map((ca) => ({
      ...ca,
      items: (JSON.parse(ca.items) as { variantId: number; qty: number }[]).map((i) => ({ ...i, name: names.get(i.variantId) ?? "?" })),
    })),
  });

});

/** An unfinished checkout removed from the list (handled, test, spam). */
cartRoutes.delete("/carts/:id", requirePermission("carts.view"), async (c) => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM carts WHERE id = ?").bind(id),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "cart", id),
  ]);
  return c.json({ ok: true });
});

cartRoutes.post("/carts/:id/contacted", requirePermission("carts.view"), async (c) => {
  await c.env.DB.prepare("UPDATE carts SET last_contacted_at = ? WHERE id = ?").bind(Date.now(), c.req.param("id")).run();
  return c.json({ ok: true });
});
