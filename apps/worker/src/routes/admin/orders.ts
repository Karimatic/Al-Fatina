/**
 * Admin → Commandes: the list and its filters, an order's page, status changes (one or many),
 * editing, notes, delivery slips, the CSV export, and deleting orders (owner only).
 */
import { Hono } from "hono";
import { z } from "zod";
import { assessRisk, cleanText, customerRiskSql, customerSegment, dzPhone, formatDzPhone, nextStatuses, ORDER_STATUSES, OUTCOME_REASON_LABEL, OUTCOME_REASONS, RISK_LEVELS, sourceLabel, STATUS_LABELS, statusPath, type OrderStatus } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { variantLabels } from "../../lib/catalog";
import { csvCell } from "../../lib/csv";
import { body, HttpError, intParam } from "../../lib/http";
import { applyStatusChange, deleteOrder } from "../../lib/orders";
import { getSettings } from "../../lib/settings";
import { permissionFor, syncOrderMessage } from "../../lib/telegram";
import { actorOf, requireOwner, requirePermission } from "../../middleware/access";
import { OPEN_DUPLICATE_SQL } from "../../lib/duplicates";
import { DEFAULT_SLA, hasPermission, isEditable, orderProfit, slaLateMinutes, slaLimitMinutes, slaStage, type ProfitResult, type SlaSettings } from "@henine/shared";
import { lateOrdersSql } from "../../lib/alerts";

export const orderRoutes = new Hono<AppEnv>();

/* ───────────── Orders ───────────── */

export type RiskCounters = {
  delivered_count: number | null; returned_count: number | null; cancelled_count: number | null; fake_count: number | null;
  is_blacklisted: number | null; risk_flags: string | null;
};
const riskOf = (r: RiskCounters) =>
  assessRisk(
    {
      deliveredCount: r.delivered_count ?? 0, returnedCount: r.returned_count ?? 0, cancelledCount: r.cancelled_count ?? 0,
      fakeCount: r.fake_count ?? 0, isBlacklisted: !!r.is_blacklisted,
    },
    r.risk_flags ? (JSON.parse(r.risk_flags) as string[]) : [],
  );

/**
 * "Needs attention" filters, shared by the orders list and the dashboard command center.
 * Each is a condition on `orders o` (+ `customers c`); `now` is generated server-side.
 */
/** Hours after which an unconfirmed site order is offered for « free the stock » (audit SEC-1, no captcha). */
export const STALE_HOLD_HOURS = 48;
export const staleHoldSql = (now: number) =>
  `o.channel IN ('web','express') AND o.status IN ('nouvelle','injoignable') AND o.created_at < ${now - STALE_HOLD_HOURS * 3600_000}
   AND (o.status = 'injoignable' OR o.confirm_attempts > 0
        OR EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind IN ('call','whatsapp','sms')))`;
// only orders the team already tried to reach (an order nobody called over a weekend is not
// « unreachable »: audit R4-3)

export function attentionSql(now: number, sla: SlaSettings = DEFAULT_SLA): Record<string, string> {
  const h = 3600_000;
  return {
    // past the order SLA (Paramètres → Délais de traitement)
    late: lateOrdersSql(now, sla),
    to_confirm: "o.status IN ('nouvelle','injoignable')",
    callbacks: `o.status = 'injoignable' AND o.next_callback_at <= ${now}`,
    high_risk: `o.status IN ('nouvelle','injoignable') AND (o.risk_score >= ${RISK_LEVELS.high} OR ${customerRiskSql("c")} >= ${RISK_LEVELS.high})`,
    stale_confirmed: `o.status = 'confirmee' AND COALESCE(o.confirmed_at, o.updated_at) < ${now - 24 * h}`,
    stale_preparing: `o.status = 'en_preparation' AND o.updated_at < ${now - 48 * h}`,
    stale_shipped: `o.status IN ('expediee','en_livraison') AND COALESCE(o.shipped_at, o.updated_at) < ${now - 7 * 24 * h}`,
    // site orders nobody could confirm in 48 h: they hold stock (fake orders do this on purpose)
    stale_unconfirmed: staleHoldSql(now),
    returns: "o.status = 'retour'",
    // flagged as a possible duplicate, not decided yet
    duplicates: OPEN_DUPLICATE_SQL("o"),
  };
}

/** The orders list's filters (status tab, attention, search, wilaya, dates, source), shared with the CSV export. */
function orderFilters(q: (k: string) => string | undefined, sla: Parameters<typeof attentionSql>[1]): { where: string[]; binds: unknown[] } {
  const status = q("status") ?? "active";
  const attention = q("attention");
  const text = (q("q") ?? "").trim();
  const where: string[] = [];
  const binds: unknown[] = [];
  const groups: Record<string, string[]> = {
    active: ["nouvelle", "injoignable", "confirmee", "en_preparation"],
    a_confirmer: ["nouvelle", "injoignable"],
    // the "Expédiées" tab: on their way (confirmed and in-preparation orders have their own tabs)
    en_cours: ["expediee", "en_livraison"],
    termine: ["livree"],
    annule: ["annulee", "doublon", "fausse"],
    retours: ["retour", "retour_recu"],
  };
  const attentions = attentionSql(Date.now(), sla);
  const attn = attention && Object.hasOwn(attentions, attention) ? attentions[attention] : undefined;
  if (attn) where.push(attn);
  else if (groups[status]) {
    where.push(`o.status IN (${groups[status]!.map(() => "?").join(",")})`);
    binds.push(...groups[status]!);
  } else if ((ORDER_STATUSES as readonly string[]).includes(status)) {
    where.push("o.status = ?");
    binds.push(status);
  }
  if (text) {
    const digits = text.replace(/\D/g, "");
    where.push("(o.public_code LIKE ? OR o.name LIKE ? OR o.phone LIKE ? OR o.tracking_number = ?)");
    binds.push(`%${text.toUpperCase()}%`, `%${text}%`, `%${digits || text}%`, text);
  }
  const wilaya = Number(q("wilaya") ?? 0);
  if (Number.isInteger(wilaya) && wilaya >= 1 && wilaya <= 69) {
    where.push("o.wilaya_code = ?");
    binds.push(wilaya);
  }
  const from = Number(q("from") ?? 0);
  const to = Number(q("to") ?? 0);
  if (from > 0) {
    where.push("o.created_at >= ?");
    binds.push(from);
  }
  if (to > 0) {
    where.push("o.created_at < ?");
    binds.push(to);
  }
  // Statistiques → Sources: the orders of one source
  const source = (q("source") ?? "").trim();
  if (source && source.length <= 30) {
    where.push("COALESCE(o.source, 'direct') = ?");
    binds.push(source);
  }
  return { where, binds };
}

orderRoutes.get("/orders", requirePermission("orders.view"), async (c) => {
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const { operations } = await getSettings(c.env, ["operations"]);
  const { where, binds } = orderFilters((k) => c.req.query(k), operations.sla);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.channel, o.source, o.name, o.phone, o.total, o.wilaya_code, w.name_fr AS wilaya, o.delivery_type,
              o.created_at, o.risk_score, o.risk_flags, o.confirm_attempts, o.next_callback_at, o.tracking_number, o.outcome_reason,
              (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items,
              c.returned_count, c.delivered_count, c.cancelled_count, c.fake_count, c.is_blacklisted,
              ${OPEN_DUPLICATE_SQL("o")} AS duplicate
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN customers c ON c.id = o.customer_id
         ${whereSql} ORDER BY o.created_at DESC LIMIT 50 OFFSET ?`,
    ).bind(...binds, page * 50),
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status"),
  ]);
  return c.json({
    rows: (rows!.results as (Record<string, unknown> & RiskCounters)[]).map(({ risk_flags, ...r }) => {
      const risk = riskOf({ ...r, risk_flags });
      return { ...r, risk: { level: risk.level, score: risk.score } };
    }),
    counts: Object.fromEntries((counts!.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
  });
});

/**
 * Site orders unconfirmed for 48 h and the pieces they hold. Freeing them is a manual choice
 * (« Libérer le stock » → cancelled as unreachable, through the bulk change below): no customer
 * is ever cancelled by surprise, and a flood of fake orders can't keep the stock for long.
 */
orderRoutes.get("/orders/stale-holds", requirePermission("orders.view"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi WHERE oi.order_id = o.id) AS pieces
       FROM orders o WHERE ${staleHoldSql(Date.now())} ORDER BY o.created_at LIMIT 200`,
  ).all<{ id: number; pieces: number }>();
  return c.json({ hours: STALE_HOLD_HOURS, orders: results.length, pieces: results.reduce((n, r) => n + r.pieces, 0), ids: results.slice(0, 50).map((r) => r.id) });
});

/**
 * Several orders at once (selection in the orders list), the same steps as on one order;
 * cancelling and returns carry one reason for all. "Expédiée" needs each order's tracking
 * number, so it stays one by one. Each order goes through the same checks as a single change.
 */
const BULK_TARGETS = ["confirmee", "injoignable", "en_preparation", "expediee", "en_livraison", "livree", "annulee", "doublon", "fausse", "retour", "retour_recu", "nouvelle"] as const;

orderRoutes.post("/orders/bulk-status", requirePermission("orders.view"), async (c) => {
  const input = await body(
    c,
    z.object({ ids: z.array(z.number().int().positive()).min(1).max(50), to: z.enum(BULK_TARGETS), reason: z.enum(OUTCOME_REASONS).optional() }),
  );
  const perms = c.get("member").permissions;
  if (!hasPermission(perms, permissionFor(input.to))) throw new HttpError(403, "forbidden");
  const actor = actorOf(c.get("member"));
  const done: string[] = [];
  const failed: { id: number; error: string }[] = [];
  const note = ["action groupée", input.reason ? OUTCOME_REASON_LABEL[input.reason] : null].filter(Boolean).join(" · ");
  const ids = [...new Set(input.ids)];
  const { results: current } = await c.env.DB.prepare(`SELECT id, status FROM orders WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: number; status: OrderStatus }>();
  const statusOf = new Map(current.map((o) => [o.id, o.status]));
  for (const id of ids) {
    try {
      // straight to the chosen tab: every step in between is applied in order (stock stays right)
      const from = statusOf.get(id);
      if (!from) throw new HttpError(404, "not_found");
      const path = statusPath(from, input.to);
      if (!path?.length) throw new HttpError(409, "invalid_transition");
      if (path.some((step) => !hasPermission(perms, permissionFor(step)))) throw new HttpError(403, "forbidden");
      let r = { code: "" };
      for (const step of path) {
        const last = step === input.to;
        r = await applyStatusChange(c.env, id, step, actor, "admin", note, last ? input.reason : undefined);
      }
      done.push(r.code);
      c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
    } catch (err) {
      failed.push({ id, error: err instanceof HttpError ? err.code : "error" });
    }
  }
  return c.json({ done, failed });
});

/** Packing slips: everything the parcel needs, for up to 50 orders. */
orderRoutes.get("/order-slips", requirePermission("orders.view"), async (c) => {
  const ids = [...new Set((c.req.query("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
  if (!ids.length) throw new HttpError(400, "no_orders");
  const ph = ids.map(() => "?").join(",");
  const [orders, items] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.created_at, o.name, o.phone, o.wilaya_code, w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar,
              COALESCE(cm.name_fr, o.commune_text) AS commune_fr, COALESCE(cm.name_ar, o.commune_text) AS commune_ar, o.address, o.delivery_type,
              o.subtotal, o.discount_total, o.shipping_price, o.total, o.customer_note, o.tracking_number, o.locale, o.coupon_code
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
        WHERE o.id IN (${ph})`,
    ).bind(...ids),
    c.env.DB.prepare(`SELECT order_id, name_fr, name_ar, options_label, sku, qty, unit_price FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...ids),
  ]);
  const { contact, store } = await getSettings(c.env, ["contact", "store"]);
  const byId = new Map((orders!.results as { id: number }[]).map((o) => [o.id, o]));
  const lines = items!.results as { order_id: number }[];
  return c.json({
    store: { name: store.name, phone: contact.phone ?? contact.whatsapp, address: contact.address_fr },
    slips: ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id)!, items: lines.filter((l) => l.order_id === id) })),
  });
});

orderRoutes.get("/orders/:id", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const o = await c.env.DB.prepare(
    `SELECT o.*, w.name_fr AS wilaya_fr, cm.name_fr AS commune_fr, c.orders_count, c.delivered_count, c.returned_count,
            c.cancelled_count, c.fake_count, c.is_blacklisted, c.total_spent, c.points_balance, m.name AS assigned_name
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
       LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN team_members m ON m.id = o.assigned_to
      WHERE o.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown> & RiskCounters & { status: OrderStatus; total_spent: number | null; track_token_hash?: string; ip_hash?: string; op_nonce?: string }>();
  if (!o) throw new HttpError(404, "not_found");
  const risk = riskOf(o);
  const segment = customerSegment({
    deliveredCount: o.delivered_count ?? 0, returnedCount: o.returned_count ?? 0, cancelledCount: o.cancelled_count ?? 0,
    fakeCount: o.fake_count ?? 0, isBlacklisted: !!o.is_blacklisted, totalSpent: o.total_spent ?? 0,
  });
  delete o.track_token_hash;
  delete o.ip_hash;
  delete o.op_nonce;
  const customerId = o.customer_id as number;
  const known = (o.phone as string) !== ""; // walk-in sales without a number share one record
  const [items, events, changes, exchanges, previous, contacts, since] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.*, v.stock_on_hand - v.stock_reserved AS available, p.cost_price
         FROM order_items oi LEFT JOIN variants v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
    ).bind(id),
    c.env.DB.prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY id").bind(id),
    c.env.DB.prepare("SELECT * FROM order_changes WHERE order_id = ? ORDER BY id").bind(id),
    c.env.DB.prepare(
      `SELECT x.*, oi.name_fr AS product, oi.options_label AS from_label, v.stock_on_hand - v.stock_reserved AS available
         FROM exchange_requests x JOIN order_items oi ON oi.id = x.order_item_id LEFT JOIN variants v ON v.id = x.to_variant_id
        WHERE x.order_id = ? ORDER BY x.id`,
    ).bind(id),
    // the customer's other orders
    c.env.DB.prepare("SELECT id, public_code, status, total, created_at FROM orders WHERE customer_id = ? AND id != ? AND ? ORDER BY created_at DESC LIMIT 8").bind(
      customerId, id, known ? 1 : 0,
    ),
    // every contact with her, on all her orders
    c.env.DB.prepare(
      `SELECT e.id, e.order_id, e.kind, e.actor, e.note, e.created_at, o.public_code FROM order_events e JOIN orders o ON o.id = e.order_id
        WHERE (e.order_id = ? OR (o.customer_id = ? AND ?)) AND e.kind IN ('call','whatsapp','sms','other','note')
        ORDER BY e.created_at DESC LIMIT 30`,
    ).bind(id, customerId, known ? 1 : 0),
    c.env.DB.prepare("SELECT MAX(created_at) AS at FROM order_events WHERE order_id = ? AND kind = 'status' AND to_status = ?").bind(id, o.status),
  ]);
  const perms = c.get("member").permissions;
  const itemRows = items!.results as ({ unit_price: number; qty: number; line_discount: number; cost_price: number | null; variant_id: number | null } & Record<string, unknown>)[];
  const exchangeRows = exchanges!.results as ({ to_variant_id: number } & Record<string, unknown>)[];
  const labels = await variantLabels(c.env, exchangeRows.map((x) => x.to_variant_id));

  // real profit (only for those who see costs)
  const { operations } = await getSettings(c.env, ["operations"]);
  let profit: ProfitResult | null = null;
  if (hasPermission(perms, "cost.view")) {
    const rate = await c.env.DB.prepare(
      "SELECT w.home_price, w.desk_price, f.carrier_fee, f.return_fee FROM wilayas w LEFT JOIN order_finance f ON f.order_id = ? WHERE w.code = ?",
    )
      .bind(o.id, o.wilaya_code)
      .first<{ home_price: number | null; desk_price: number | null; carrier_fee: number | null; return_fee: number | null }>();
    const boutique = o.channel === "boutique";
    const returned = o.status === "retour" || o.status === "retour_recu";
    // the courier's real fee once recorded (Finance → Encaissements), else the wilaya's rate
    const recordedFee = returned ? rate?.return_fee : rate?.carrier_fee;
    profit = orderProfit({
      items: itemRows.map((i) => ({ unitPrice: i.unit_price - i.line_discount, qty: i.qty, unitCost: i.cost_price })),
      discount: o.discount_total as number,
      shippingCharged: o.shipping_price as number,
      shippingCost: boutique ? 0 : (recordedFee ?? (o.delivery_type === "bureau" ? rate?.desk_price : rate?.home_price) ?? 0),
      packagingCost: boutique ? 0 : operations.packaging_cost,
      returned,
    });
  } else for (const i of itemRows) delete (i as Partial<typeof i>).cost_price;

  // SLA: the step it's waiting on, since when, and how late
  const stage = slaStage(o.status);
  const enteredAt = ((since!.results[0] as { at: number | null }).at ?? (o.created_at as number));
  const contactRows = contacts!.results as { kind: string; created_at: number }[];
  return c.json({
    order: o,
    items: itemRows,
    events: events!.results,
    changes: changes!.results,
    exchanges: exchangeRows.map((x) => ({ ...x, to_label: labels.get(x.to_variant_id)?.fr ?? null })),
    previous: previous!.results,
    contacts: contactRows,
    lastContactAt: contactRows.find((x) => x.kind !== "note")?.created_at ?? null,
    profit,
    sla: stage ? { stage, since: enteredAt, limit: slaLimitMinutes(stage, operations.sla), late: slaLateMinutes(o.status, enteredAt, operations.sla) } : null,
    editable: isEditable(o.status),
    canDiscount: hasPermission(perms, "orders.discount"),
    next: nextStatuses(o.status).filter((s) => hasPermission(perms, permissionFor(s))),
    risk,
    segment,
  });
});

orderRoutes.post("/orders/:id/status", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      to: z.enum(ORDER_STATUSES),
      note: cleanText(300).optional(),
      reason: z.enum(OUTCOME_REASONS).optional(),
      /** "Expédiée": the ZR Express tracking number, saved in the same step */
      trackingNumber: cleanText(60).optional(),
    }),
  );
  if (!hasPermission(c.get("member").permissions, permissionFor(input.to))) throw new HttpError(403, "forbidden");
  if (input.trackingNumber) {
    await c.env.DB.prepare("UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?").bind(input.trackingNumber, Date.now(), id).run();
  }
  const note = [input.reason ? OUTCOME_REASON_LABEL[input.reason] : null, input.note].filter(Boolean).join(" · ") || undefined;
  const res = await applyStatusChange(c.env, id, input.to, actorOf(c.get("member")), "admin", note, input.reason);
  c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
  return c.json(res);
});

/** Fields that change what is shipped: only before the parcel leaves the shop. */
const SHIPPING_FIELDS = ["name", "phone", "wilayaCode", "communeId", "address", "deliveryType", "shippingPrice"] as const;

orderRoutes.patch("/orders/:id", requirePermission("orders.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(80).pipe(z.string().min(2)).optional(),
      phone: dzPhone.optional(),
      wilayaCode: z.number().int().min(1).max(69).optional(),
      communeId: z.number().int().positive().nullable().optional(),
      address: cleanText(200).nullable().optional(),
      deliveryType: z.enum(["domicile", "bureau"]).optional(),
      shippingPrice: z.number().int().min(0).max(10000).optional(),
      internalNote: cleanText(1000).nullable().optional(),
      trackingNumber: cleanText(60).nullable().optional(),
      assignedTo: z.number().int().positive().nullable().optional(),
      outcomeReason: z.enum(OUTCOME_REASONS).nullable().optional(),
      customerNote: cleanText(500).nullable().optional(),
      /** why (kept in the order's change history) */
      reason: cleanText(300).optional(),
    }),
  );
  const { reason, ...fields } = input;
  const map: Record<string, string> = {
    name: "name", phone: "phone", wilayaCode: "wilaya_code", communeId: "commune_id", address: "address", deliveryType: "delivery_type",
    shippingPrice: "shipping_price", internalNote: "internal_note", trackingNumber: "tracking_number", assignedTo: "assigned_to",
    outcomeReason: "outcome_reason", customerNote: "customer_note",
  };
  const cur = await c.env.DB.prepare(`SELECT status, customer_id, ${Object.values(map).join(", ")} FROM orders WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown> & { status: OrderStatus; customer_id: number }>();
  if (!cur) throw new HttpError(404, "not_found");
  // only what really changes
  const changed = Object.keys(fields).filter((k) => ((fields as Record<string, unknown>)[k] ?? null) !== (cur[map[k]!] ?? null));
  if (!changed.length) return c.json({ ok: true });
  if (!isEditable(cur.status) && changed.some((k) => (SHIPPING_FIELDS as readonly string[]).includes(k))) throw new HttpError(409, "order_locked");

  const actor = actorOf(c.get("member"));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE orders SET ${changed.map((k) => `${map[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(
      ...changed.map((k) => (fields as Record<string, unknown>)[k] ?? null), now, id,
    ),
  ];
  if (changed.includes("shippingPrice")) stmts.push(c.env.DB.prepare("UPDATE orders SET total = subtotal - discount_total + shipping_price WHERE id = ?").bind(id));
  // a new phone number: the order follows that customer's profile (created if she's new)
  if (changed.includes("phone") && fields.phone) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO customers (phone, name, wilaya_code, orders_count, first_order_at, last_order_at, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(phone) DO NOTHING`,
      ).bind(fields.phone, fields.name ?? cur.name, fields.wilayaCode ?? cur.wilaya_code, now, now, now),
      c.env.DB.prepare("UPDATE customers SET orders_count = MAX(orders_count - 1, 0) WHERE id = ?").bind(cur.customer_id),
      c.env.DB.prepare("UPDATE orders SET customer_id = (SELECT id FROM customers WHERE phone = ?) WHERE id = ?").bind(fields.phone, id),
      c.env.DB.prepare("UPDATE customers SET orders_count = orders_count + 1, last_order_at = ? WHERE phone = ?").bind(now, fields.phone),
    );
  }
  for (const k of changed) {
    const show = (v: unknown) => (v == null || v === "" ? null : String(v));
    stmts.push(
      c.env.DB.prepare("INSERT INTO order_changes (order_id, field, old_value, new_value, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        id, map[k], show(cur[map[k]!]), show((fields as Record<string, unknown>)[k]), reason ?? null, actor, now,
      ),
    );
  }
  stmts.push(
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, 'edit', ?, 'admin', ?, ?)").bind(
      id, actor, `Modifié : ${changed.join(", ")}${reason ? ` · ${reason}` : ""}`, now,
    ),
    auditStmt(c.env, actor, "update", "order", id, { fields: changed, reason }),
  );
  await c.env.DB.batch(stmts);
  c.executionCtx.waitUntil(syncOrderMessage(c.env, id).catch(() => undefined));
  return c.json({ ok: true });
});

orderRoutes.post("/orders/:id/note", requirePermission("orders.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ note: cleanText(1000).pipe(z.string().min(1)), kind: z.enum(["note", "call", "whatsapp"]).default("note") }));
  await c.env.DB.prepare("INSERT INTO order_events (order_id, kind, actor, source, note, created_at) VALUES (?, ?, ?, 'admin', ?, ?)")
    .bind(id, input.kind, actorOf(c.get("member")), input.note, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

/** Column titles of the orders export, in the admin's language. */
const CSV_COLUMNS = {
  fr: ["N° commande", "Date", "Heure", "Statut", "Cliente", "Téléphone", "Wilaya", "Commune", "Adresse", "Livraison", "Articles", "Pièces", "Sous-total (DA)", "Remise (DA)", "Livraison (DA)", "Total (DA)", "Code promo", "Source", "N° de suivi"],
  ar: ["رقم الطلب", "التاريخ", "الساعة", "الحالة", "الزبونة", "الهاتف", "الولاية", "البلدية", "العنوان", "التوصيل", "المنتجات", "عدد القطع", "المجموع الفرعي (دج)", "التخفيض (دج)", "سعر التوصيل (دج)", "المجموع (دج)", "كود الخصم", "المصدر", "رقم التتبع"],
};

/**
 * Orders as a spreadsheet (Excel / Google Sheets): one order per line, titles in the admin's
 * language, date and time apart, the products written out, a totals line at the end. Follows
 * the filters on screen (tab, search, wilaya, source, dates).
 */
orderRoutes.get("/orders.csv", requirePermission("orders.export"), async (c) => {
  const lang = c.req.query("lang") === "ar" ? "ar" : "fr";
  const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 90) || 90));
  const { operations, sources } = await getSettings(c.env, ["operations", "sources"]);
  const { where, binds } = orderFilters((k) => (k === "status" ? (c.req.query("status") ?? "all") : c.req.query(k)), operations.sla);
  // without dates, the last `days` days
  if (!c.req.query("from")) {
    where.push("o.created_at >= ?");
    binds.push(Date.now() - days * 86400_000);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT o.public_code, o.created_at, o.status, o.source, o.name, o.phone, o.wilaya_code, w.name_fr AS wilaya_fr, w.name_ar AS wilaya_ar,
            cm.name_fr AS commune_fr, cm.name_ar AS commune_ar, o.commune_text, o.address, o.delivery_type,
            o.subtotal, o.discount_total, o.shipping_price, o.total, o.coupon_code, o.tracking_number,
            (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS pieces,
            (SELECT GROUP_CONCAT(qty || ' × ' || name_fr || COALESCE(' (' || options_label || ')', ''), ' / ') FROM order_items WHERE order_id = o.id) AS articles
       FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code LEFT JOIN communes cm ON cm.id = o.commune_id
      WHERE ${where.join(" AND ")} ORDER BY o.created_at DESC LIMIT 5000`,
  )
    .bind(...binds)
    .all<Record<string, string | number | null>>();
  const algiers = (ts: number) => new Date(ts + 3600_000).toISOString();
  const lines = results.map((r) => {
    const at = algiers(Number(r.created_at));
    return [
      r.public_code,
      at.slice(0, 10),
      at.slice(11, 16),
      STATUS_LABELS[r.status as OrderStatus]?.[lang] ?? r.status,
      r.name,
      // spaced like on a phone: a spreadsheet keeps it as text (and its leading 0)
      formatDzPhone(String(r.phone ?? "")),
      `${String(r.wilaya_code).padStart(2, "0")} - ${(lang === "ar" ? r.wilaya_ar : r.wilaya_fr) ?? ""}`,
      (lang === "ar" ? r.commune_ar : r.commune_fr) ?? r.commune_text,
      r.address,
      r.delivery_type === "bureau" ? (lang === "ar" ? "المكتب" : "Bureau") : lang === "ar" ? "المنزل" : "Domicile",
      r.articles,
      r.pieces,
      r.subtotal,
      r.discount_total || "",
      r.shipping_price,
      r.total,
      r.coupon_code,
      sourceLabel(String(r.source ?? "direct"), sources, lang).name,
      r.tracking_number,
    ].map(csvCell).join(";");
  });
  const sum = (k: string) => results.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const totalLine = [lang === "ar" ? `المجموع: ${results.length} طلب` : `Total : ${results.length} commandes`, "", "", "", "", "", "", "", "", "", "", sum("pieces"), sum("subtotal"), sum("discount_total"), sum("shipping_price"), sum("total"), "", "", ""]
    .map(csvCell)
    .join(";");
  const csv = [CSV_COLUMNS[lang].map(csvCell).join(";"), ...lines, totalLine].join("\r\n");
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "export", "orders", null, { days, rows: results.length })]);
  const name = `commandes-${algiers(Date.now()).slice(0, 10)}.csv`;
  // the BOM makes Excel read the Arabic and the accents correctly
  return new Response(`\uFEFF${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
});

/* ───────────── Deleting (owner only) ───────────── */

/** ?restock=1: pieces that already left the shop come back to stock (a test order). */
orderRoutes.delete("/orders/:id", requireOwner, async (c) => {
  const r = await deleteOrder(c.env, intParam(c, "id"), actorOf(c.get("member")), c.req.query("restock") === "1");
  return c.json(r);
});

orderRoutes.post("/orders/bulk-delete", requireOwner, async (c) => {
  const input = await body(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(50), restock: z.boolean().default(false) }));
  const done: string[] = [];
  for (const id of new Set(input.ids)) {
    try {
      done.push((await deleteOrder(c.env, id, actorOf(c.get("member")), input.restock)).code);
    } catch {
      /* already deleted */
    }
  }
  return c.json({ done });
});
