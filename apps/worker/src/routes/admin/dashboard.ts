/**
 * Admin → Tableau de bord (the team's command center) and Statistiques.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { HttpError } from "../../lib/http";
import { mediaUrl, variantLabels } from "../../lib/catalog";
import { algiersDayStart, CANCELLED_SQL, periodStats } from "../../lib/orders";
import { getSettings } from "../../lib/settings";
import { requirePermission } from "../../middleware/access";
import { ABANDONED_AFTER } from "./carts";
import { attentionSql } from "./orders";

export const dashboardRoutes = new Hono<AppEnv>();

const ACTIVE = "'nouvelle','injoignable','confirmee','en_preparation','expediee','en_livraison','retour'";
/* ───────────── Dashboard: the team's command center ───────────── */

dashboardRoutes.get("/dashboard", requirePermission("dashboard.view"), async (c) => {
  const now = Date.now();
  const dayStart = algiersDayStart(now);
  const day = 86400_000;
  const [today, week, prevWeek, month, prevMonth] = await Promise.all([
    periodStats(c.env, dayStart),
    periodStats(c.env, dayStart - 6 * day),
    periodStats(c.env, dayStart - 13 * day, dayStart - 6 * day),
    periodStats(c.env, dayStart - 29 * day),
    periodStats(c.env, dayStart - 59 * day, dayStart - 29 * day),
  ]);
  const since30 = dayStart - 29 * day;
  // widgets: best product of the month (with weekly units), revenue by channel, returning customers
  const [topProduct, channels, loyalty, last14] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT oi.product_id, p.name_fr, COALESCE(p.published_at, p.created_at) AS published_at,
              (SELECT base_key FROM product_images i WHERE i.product_id = oi.product_id ORDER BY sort, id LIMIT 1) AS image_key,
              SUM(oi.qty) AS units, COUNT(DISTINCT oi.order_id) AS orders, SUM(oi.qty * oi.unit_price) AS revenue,
              SUM(CASE WHEN o.created_at >= ?2 THEN oi.qty ELSE 0 END) AS w4,
              SUM(CASE WHEN o.created_at >= ?3 AND o.created_at < ?2 THEN oi.qty ELSE 0 END) AS w3,
              SUM(CASE WHEN o.created_at >= ?4 AND o.created_at < ?3 THEN oi.qty ELSE 0 END) AS w2,
              SUM(CASE WHEN o.created_at < ?4 THEN oi.qty ELSE 0 END) AS w1
         FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.created_at >= ?1 AND o.status NOT IN ${CANCELLED_SQL} AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id ORDER BY units DESC LIMIT 1`,
    ).bind(since30, now - 7 * day, now - 14 * day, now - 21 * day),
    c.env.DB.prepare(
      `SELECT channel, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders
        WHERE created_at >= ? AND status NOT IN ${CANCELLED_SQL} GROUP BY channel ORDER BY revenue DESC`,
    ).bind(since30),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS orders, SUM(CASE WHEN c.delivered_count > 0 OR c.orders_count > 1 THEN 1 ELSE 0 END) AS returning_orders
         FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.created_at >= ? AND o.status NOT IN ${CANCELLED_SQL}`,
    ).bind(since30),
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', (created_at + 3600000) / 1000, 'unixepoch') AS date, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
         FROM orders WHERE created_at >= ? AND status NOT IN ${CANCELLED_SQL} GROUP BY date ORDER BY date`,
    ).bind(dayStart - 13 * day),
  ]);
  const { operations } = await getSettings(c.env, ["operations"]);
  const attn = attentionSql(now, operations.sla);
  const attnCols = Object.entries(attn).map(([k, cond]) => `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS ${k}`).join(", ");
  const [pipeline, attention, carts, lowStock, stockCounts, restocked, recent, reviews, messages, outbox] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE status IN (${ACTIVE}) GROUP BY status`),
    // one pass over the active orders (status index) for every "needs attention" counter
    c.env.DB.prepare(`SELECT ${attnCols} FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN (${ACTIVE})`),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(value), 0) AS value FROM carts
        WHERE recovered_order_id IS NULL AND last_contacted_at IS NULL AND updated_at < ? AND updated_at > ?`,
    ).bind(now - ABANDONED_AFTER, now - 86400_000),
    c.env.DB.prepare(
      `SELECT v.id, p.id AS product_id, p.name_fr, v.stock_on_hand - v.stock_reserved AS available,
              (SELECT COUNT(*) FROM stock_alerts a WHERE a.variant_id = v.id AND a.notified_at IS NULL) AS waiting
         FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = 1 AND p.status = 'published' AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold
        ORDER BY available ASC, waiting DESC LIMIT 10`,
    ),
    c.env.DB.prepare(
      `SELECT SUM(CASE WHEN v.stock_on_hand - v.stock_reserved <= 0 THEN 1 ELSE 0 END) AS out_count,
              SUM(CASE WHEN v.stock_on_hand - v.stock_reserved > 0 AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold THEN 1 ELSE 0 END) AS low_count
         FROM variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.status = 'published'`,
    ),
    // back in stock while customers are still waiting to be told
    c.env.DB.prepare(
      `SELECT a.variant_id AS id, p.id AS product_id, p.name_fr, v.stock_on_hand - v.stock_reserved AS available, COUNT(*) AS waiting
         FROM stock_alerts a JOIN variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
        WHERE a.notified_at IS NULL AND v.stock_on_hand - v.stock_reserved > 0
        GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 10`,
    ),
    c.env.DB.prepare(
      `SELECT o.id, o.public_code, o.status, o.name, o.total, o.created_at, w.name_fr AS wilaya FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code
        ORDER BY o.id DESC LIMIT 8`,
    ),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE done_at IS NULL AND attempts > 0"),
  ]);
  const low = lowStock!.results as { id: number; product_id: number; name_fr: string; available: number; waiting: number }[];
  const back = restocked!.results as { id: number; product_id: number; name_fr: string; available: number; waiting: number }[];
  const labels = await variantLabels(c.env, [...low, ...back].map((v) => v.id));
  const withLabel = <T extends { id: number }>(v: T) => ({ ...v, options: labels.get(v.id)?.fr ?? "" });
  const a = (attention!.results[0] ?? {}) as Record<string, number | null>;
  // failed deliveries to follow up (Expéditions)
  const fu = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN status IN ('needs_contact','contacted','callback','retry_requested','unreachable') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status IN ('needs_contact','contacted','callback','retry_requested','unreachable') AND COALESCE(next_action_at, 0) <= ? THEN 1 ELSE 0 END) AS due
       FROM delivery_followups`,
  )
    .bind(now)
    .first<{ open: number | null; due: number | null }>();
  const cartRow = carts!.results[0] as { n: number; value: number };
  const sc = stockCounts!.results[0] as { out_count: number | null; low_count: number | null };
  // cancelled orders (annulée / doublon / fausse) are never counted as orders or revenue
  return c.json({
    kpis: {
      ordersToday: today.orders,
      revenueToday: today.revenue,
      revenue7: week.revenue,
      revenue30: month.revenue,
      orders7: week.orders,
      cancelledToday: today.cancelled,
      confirmRate7: week.confirmRate,
      avgBasket30: month.orders ? Math.round(month.revenue / month.orders) : null,
    },
    pipeline: Object.fromEntries((pipeline!.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
    attention: {
      ...Object.fromEntries(Object.keys(attn).map((k) => [k, a[k] ?? 0])),
      abandoned: cartRow.n,
      abandonedValue: cartRow.value,
      restocked: back.length,
      outOfStock: sc.out_count ?? 0,
      lowStock: sc.low_count ?? 0,
      pendingReviews: (reviews!.results[0] as { n: number }).n,
      newMessages: (messages!.results[0] as { n: number }).n,
      telegramBacklog: (outbox!.results[0] as { n: number }).n,
      failedDeliveries: fu?.open ?? 0,
      followupsDue: fu?.due ?? 0,
    },
    lowStock: low.map(withLabel),
    restocked: back.map(withLabel),
    recent: recent!.results,
    week,
    prevWeek,
    month,
    prevMonth,
    topProduct: ((r) =>
      r
        ? {
            id: r.product_id, name: r.name_fr, publishedAt: r.published_at, units: r.units, orders: r.orders, revenue: r.revenue,
            weeks: [r.w1, r.w2, r.w3, r.w4].map((v) => v ?? 0),
            image: r.image_key ? mediaUrl(c.env, r.image_key).replace("{w}", "480") : null,
          }
        : null)(topProduct!.results[0] as
      | { product_id: number; name_fr: string; published_at: number; image_key: string | null; units: number; orders: number; revenue: number; w1: number; w2: number; w3: number; w4: number }
      | undefined),
    channels: channels!.results,
    last14: { since: dayStart - 13 * day, days: last14!.results },
    returningShare: ((l) => (l?.orders ? Math.round(((l.returning_orders ?? 0) / l.orders) * 100) : null))(loyalty!.results[0] as { orders: number; returning_orders: number | null } | undefined),
  });
});

/* ───────────── Statistiques ───────────── */

/** "today" | "7" | "30" | "90" | "365" | custom from/to (YYYY-MM-DD, Africa/Algiers days). */
export function statsRange(q: (k: string) => string | undefined): { since: number; until: number; label: string; days: number } {
  const now = Date.now();
  const today = algiersDayStart(now);
  const from = q("from");
  const to = q("to");
  const day = (d: string) => Date.parse(`${d}T00:00:00+01:00`);
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && day(from) <= day(to)) {
    const since = day(from);
    const until = Math.min(day(to) + 86400_000, now + 1);
    if (until - since > 366 * 86400_000) throw new HttpError(422, "range_too_long");
    return { since, until, label: `${from} → ${to}`, days: Math.max(1, Math.round((until - since) / 86400_000)) };
  }
  const r = q("range") ?? q("days") ?? "30";
  if (r === "today") return { since: today, until: now + 1, label: "today", days: 1 };
  const days = Math.min(365, Math.max(1, Number(r) || 30));
  return { since: today - (days - 1) * 86400_000, until: now + 1, label: `${days}`, days };
}

const MIN_SAMPLE = 5;

dashboardRoutes.get("/stats", requirePermission("stats.view"), async (c) => {
  const { since, until, label, days } = statsRange((k) => c.req.query(k));
  const inRange = "o.created_at >= ?1 AND o.created_at < ?2";
  const valid = `o.status NOT IN ${CANCELLED_SQL}`;
  const [totals, daily, statusRows, wilayas, channels, hours, top, reasons, durations, byType, weekdays] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS placed,
              SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS orders,
              COALESCE(SUM(CASE WHEN ${valid} THEN o.total ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN o.status = 'livree' THEN o.total ELSE 0 END), 0) AS delivered_revenue,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status IN ${CANCELLED_SQL} THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN o.status IN ('nouvelle','injoignable') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN o.status IN ('confirmee','en_preparation','expediee','en_livraison') THEN 1 ELSE 0 END) AS in_progress,
              COUNT(DISTINCT CASE WHEN ${valid} THEN o.customer_id END) AS customers,
              SUM(CASE WHEN ${valid} AND c.delivered_count > 1 THEN 1 ELSE 0 END) AS repeat_orders
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE ${inRange}`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', (o.created_at + 3600000) / 1000, 'unixepoch') AS date, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue
         FROM orders o WHERE ${inRange} AND ${valid} GROUP BY date ORDER BY date`,
    ).bind(since, until),
    c.env.DB.prepare(`SELECT o.status, COUNT(*) AS n FROM orders o WHERE ${inRange} GROUP BY o.status`).bind(since, until),
    c.env.DB.prepare(
      `SELECT o.wilaya_code AS code, w.name_fr AS name, COUNT(*) AS placed,
              SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS orders,
              COALESCE(SUM(CASE WHEN ${valid} THEN o.total ELSE 0 END), 0) AS revenue,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status IN ${CANCELLED_SQL} THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
              AVG(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN (o.delivered_at - o.shipped_at) / 86400000.0 END) AS avg_days,
              SUM(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN 1 ELSE 0 END) AS timed
         FROM orders o LEFT JOIN wilayas w ON w.code = o.wilaya_code WHERE ${inRange}
        GROUP BY o.wilaya_code ORDER BY orders DESC`,
    ).bind(since, until),
    c.env.DB.prepare(`SELECT o.channel, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue FROM orders o WHERE ${inRange} AND ${valid} GROUP BY o.channel`).bind(since, until),
    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', (o.created_at + 3600000) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS orders
         FROM orders o WHERE ${inRange} AND ${valid} GROUP BY hour`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT oi.product_id, oi.name_fr, SUM(oi.qty) AS units, SUM(oi.unit_price * oi.qty) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${inRange} AND ${valid} GROUP BY oi.product_id, oi.name_fr ORDER BY units DESC LIMIT 10`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT CASE WHEN o.status IN ('retour','retour_recu') THEN 'return' ELSE 'cancel' END AS kind, COALESCE(o.outcome_reason, 'unknown') AS reason, COUNT(*) AS n
         FROM orders o WHERE ${inRange} AND o.status IN ('annulee','doublon','fausse','retour','retour_recu')
        GROUP BY kind, reason ORDER BY n DESC`,
    ).bind(since, until),
    // durations in hours for orders that reached each step (capped at 2,000 rows)
    c.env.DB.prepare(
      `SELECT (o.shipped_at - o.confirmed_at) / 3600000.0 AS prep_h,
              CASE WHEN o.status = 'livree' THEN (o.delivered_at - o.shipped_at) / 3600000.0 END AS ship_h
         FROM orders o WHERE ${inRange} AND o.shipped_at IS NOT NULL AND o.confirmed_at IS NOT NULL AND o.shipped_at >= o.confirmed_at LIMIT 2000`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT o.delivery_type AS type,
              SUM(CASE WHEN o.shipped_at IS NOT NULL THEN 1 ELSE 0 END) AS shipped,
              SUM(CASE WHEN o.status = 'livree' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status IN ('retour','retour_recu') THEN 1 ELSE 0 END) AS returned,
              AVG(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN (o.delivered_at - o.shipped_at) / 86400000.0 END) AS avg_days,
              SUM(CASE WHEN o.status = 'livree' AND o.shipped_at IS NOT NULL AND o.delivered_at > o.shipped_at THEN 1 ELSE 0 END) AS timed
         FROM orders o WHERE ${inRange} GROUP BY o.delivery_type`,
    ).bind(since, until),
    c.env.DB.prepare(
      `SELECT CAST(strftime('%w', (o.created_at + 3600000) / 1000, 'unixepoch') AS INTEGER) AS dow, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue
         FROM orders o WHERE ${inRange} AND ${valid} GROUP BY dow`,
    ).bind(since, until),
  ]);

  const t = totals!.results[0] as Record<string, number | null>;
  const n = (k: string) => t[k] ?? 0;
  const byStatus = Object.fromEntries((statusRows!.results as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const reached = (list: string[]) => list.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
  const confirmed = reached(["confirmee", "en_preparation", "expediee", "en_livraison", "livree", "retour", "retour_recu"]);
  const shipped = reached(["expediee", "en_livraison", "livree", "retour", "retour_recu"]);
  const resolved = n("delivered") + n("returned"); // parcels whose fate is known
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

  const median = (xs: number[]) => {
    if (xs.length < MIN_SAMPLE) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 10) / 10;
  };
  const d = durations!.results as { prep_h: number | null; ship_h: number | null }[];
  const prep = d.map((r) => r.prep_h).filter((x): x is number => x != null && x >= 0);
  const ship = d.map((r) => r.ship_h).filter((x): x is number => x != null && x > 0);
  const roundDays = (v: number | null, timed: number) => (v == null || timed < MIN_SAMPLE ? null : Math.round(v * 10) / 10);

  return c.json({
    range: { since, until, label, days },
    totals: {
      placed: n("placed"),
      orders: n("orders"),
      revenue: n("revenue"),
      deliveredRevenue: n("delivered_revenue"),
      avgBasket: n("orders") ? Math.round(n("revenue") / n("orders")) : null,
      delivered: n("delivered"),
      cancelled: n("cancelled"),
      returned: n("returned"),
      pending: n("pending"),
      inProgress: n("in_progress"),
      customers: n("customers"),
      repeatRate: pct(n("repeat_orders"), n("orders")),
      confirmRate: pct(confirmed, confirmed + n("cancelled")),
      deliveryRate: pct(n("delivered"), resolved),
      returnRate: pct(n("returned"), resolved),
    },
    funnel: { placed: n("placed"), confirmed, shipped, delivered: n("delivered"), returned: n("returned"), cancelled: n("cancelled") },
    daily: daily!.results,
    byStatus,
    wilayas: (wilayas!.results as Record<string, number | string | null>[]).map((w) => {
      const delivered = Number(w.delivered ?? 0);
      const returned = Number(w.returned ?? 0);
      return { ...w, deliveryRate: pct(delivered, delivered + returned), avg_days: roundDays(w.avg_days as number | null, Number(w.timed ?? 0)) };
    }),
    channels: channels!.results,
    hours: hours!.results,
    weekdays: weekdays!.results,
    topProducts: top!.results,
    reasons: reasons!.results,
    delivery: {
      minSample: MIN_SAMPLE,
      prepHoursMedian: median(prep),
      prepSample: prep.length,
      shipDaysMedian: median(ship) == null ? null : Math.round((median(ship)! / 24) * 10) / 10,
      shipSample: ship.length,
      byType: (byType!.results as Record<string, number | string | null>[]).map((r) => {
        const delivered = Number(r.delivered ?? 0);
        const returned = Number(r.returned ?? 0);
        return { ...r, deliveryRate: pct(delivered, delivered + returned), avg_days: roundDays(r.avg_days as number | null, Number(r.timed ?? 0)) };
      }),
    },
  });
});
