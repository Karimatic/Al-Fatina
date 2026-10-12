/**
 * Admin → Ventes: sales made in the shop (manual), and sales performance.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, dzPhone, orderLine } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError } from "../../lib/http";
import { createOrder } from "../../lib/orders";
import { actorOf, requirePermission } from "../../middleware/access";
import { detectDuplicates } from "../../lib/duplicates";

export const salesRoutes = new Hono<AppEnv>();

/* ───────────── Ventes: manual sales + performance ───────────── */

salesRoutes.post("/sales/manual", requirePermission("sales.create"), async (c) => {
  const input = await body(
    c,
    z.object({
      channel: z.enum(["boutique", "instagram", "whatsapp", "telephone"]),
      name: cleanText(80).pipe(z.string().min(2)).optional(),
      /** optional for a boutique sale (walk-in customer) */
      phone: dzPhone.optional(),
      lines: z.array(orderLine).min(1).max(30),
      status: z.enum(["livree", "confirmee", "nouvelle"]),
      wilaya: z.number().int().min(1).max(69).default(35),
      communeId: z.number().int().positive().nullable().default(null),
      deliveryType: z.enum(["domicile", "bureau"]).default("bureau"),
      address: cleanText(200).optional(),
      shipping: z.number().int().min(0).max(10000).optional(),
      coupon: z.string().trim().toUpperCase().max(32).optional(),
      note: cleanText(500).optional(),
    }),
  );
  if (input.channel !== "boutique" && (!input.phone || !input.name)) throw new HttpError(422, "validation_failed", { phone: "required" });
  const order = await createOrder(c.env, {
    idempotencyKey: crypto.randomUUID(),
    name: input.name ?? "Cliente en boutique",
    phone: input.phone ?? "",
    wilaya: input.wilaya,
    communeId: input.communeId,
    communeText: input.channel === "boutique" ? "Boutique" : undefined,
    deliveryType: input.deliveryType,
    address: input.address,
    coupon: input.coupon || undefined,
    lines: input.lines,
    channel: input.channel,
    locale: "fr",
    initialStatus: input.status,
    actor: actorOf(c.get("member")),
    internalNote: input.note,
    shippingOverride: input.channel === "boutique" ? 0 : input.shipping,
  });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "manual_sale", "order", order.id, { channel: input.channel, total: order.total })]);
  // an order taken by phone / Instagram may already exist on the website
  if (input.channel !== "boutique") c.executionCtx.waitUntil(detectDuplicates(c.env, order.id).catch(() => undefined));
  return c.json(order, 201);
});

salesRoutes.get("/sales", requirePermission("sales.view"), async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30)));
  const since = Date.now() - days * 86400_000;
  const valid = "o.status NOT IN ('nouvelle','injoignable','annulee','doublon','fausse')";
  const canSeeCost = c.get("member").permissions.includes("*") || c.get("member").permissions.includes("cost.view");
  const [byProduct, byChannel, totals, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.product_id, oi.name_fr, SUM(oi.qty) AS units, SUM(oi.unit_price * oi.qty) AS revenue,
              SUM(oi.qty * COALESCE(p.cost_price, 0)) AS cost,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN oi.qty ELSE 0 END) AS returned
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.created_at > ? AND ${valid}
        GROUP BY oi.product_id, oi.name_fr ORDER BY revenue DESC LIMIT 50`,
    ).bind(since),
    c.env.DB.prepare(`SELECT o.channel, COUNT(*) AS orders, SUM(o.total) AS revenue FROM orders o WHERE o.created_at > ? AND ${valid} GROUP BY o.channel ORDER BY revenue DESC`).bind(since),
    c.env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(o.subtotal - o.discount_total), 0) AS merch FROM orders o WHERE o.created_at > ? AND ${valid}`).bind(since),
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.channel, o.name, o.total, o.status, o.created_at FROM orders o WHERE o.channel IN ('boutique','instagram','whatsapp','telephone') ORDER BY o.id DESC LIMIT 15`,
    ),
  ]);
  return c.json({
    days,
    totals: totals!.results[0],
    byProduct: (byProduct!.results as Record<string, unknown>[]).map((r) => (canSeeCost ? r : { ...r, cost: null })),
    byChannel: byChannel!.results,
    recentManual: recent!.results,
  });
});
