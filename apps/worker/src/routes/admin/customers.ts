/**
 * Admin → Clients and Fidélité: the customer list and record, loyalty points and settings,
 * deleting a customer (owner only).
 */
import { Hono } from "hono";
import { z } from "zod";
import { assessRisk, cleanText, customerSegment, segmentSql, EXTRA_SEGMENTS, extraSegmentSql, type CustomerSegment } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, HttpError, intParam } from "../../lib/http";
import { noRecordCustomerStmt } from "../../lib/orders";
import { getSetting, setSetting } from "../../lib/settings";
import { actorOf, requireOwner, requirePermission } from "../../middleware/access";
import type { RiskCounters } from "./orders";

export const customerRoutes = new Hono<AppEnv>();

/* ───────────── Customers ───────────── */

/**
 * Customers (identified by phone). Segments come from real order history with the same
 * rules as the risk score (see @henine/shared risk.ts), so filters and badges always agree.
 */
customerRoutes.get("/customers", requirePermission("customers.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const segment = c.req.query("segment") ?? "all";
  // the hidden "Clientes sans fiche" entry (walk-in sales, deleted customers) is not a customer
  const where: string[] = ["c.phone != ''"];
  const binds: unknown[] = [];
  if (q) {
    where.push("(c.name LIKE ? OR c.phone LIKE ?)");
    binds.push(`%${q}%`, `%${q.replace(/\s/g, "")}%`);
  }
  const now = Date.now();
  if (["new", "returning", "vip", "high_risk"].includes(segment)) where.push(segmentSql(segment as CustomerSegment, "c"));
  else if ((EXTRA_SEGMENTS as readonly string[]).includes(segment)) where.push(extraSegmentSql(segment as (typeof EXTRA_SEGMENTS)[number], "c", now));
  const segCounts = [
    ...(["new", "returning", "vip", "high_risk"] as const).map((s) => `SUM(CASE WHEN ${segmentSql(s, "c")} THEN 1 ELSE 0 END) AS "${s}"`),
    ...EXTRA_SEGMENTS.map((s) => `SUM(CASE WHEN ${extraSegmentSql(s, "c", now)} THEN 1 ELSE 0 END) AS "${s}"`),
  ].join(", ");
  const [rows, counts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT c.id, c.name, c.phone, c.wilaya_code, w.name_fr AS wilaya, c.orders_count, c.delivered_count, c.returned_count, c.cancelled_count,
              c.fake_count, c.total_spent, c.points_balance, c.is_blacklisted, c.tags, c.last_order_at
         FROM customers c LEFT JOIN wilayas w ON w.code = c.wilaya_code
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.last_order_at DESC LIMIT 200`,
    ).bind(...binds),
    c.env.DB.prepare(`SELECT COUNT(*) AS all_count, ${segCounts} FROM customers c WHERE c.phone != ''`),
  ]);
  type Row = RiskCounters & { total_spent: number };
  return c.json({
    counts: counts!.results[0],
    rows: (rows!.results as (Record<string, unknown> & Row)[]).map((r) => {
      const h = {
        deliveredCount: r.delivered_count ?? 0, returnedCount: r.returned_count ?? 0, cancelledCount: r.cancelled_count ?? 0,
        fakeCount: r.fake_count ?? 0, isBlacklisted: !!r.is_blacklisted,
      };
      const risk = assessRisk(h);
      return { ...r, segment: customerSegment({ ...h, totalSpent: r.total_spent ?? 0 }), risk: { level: risk.level, score: risk.score } };
    }),
  });
});

customerRoutes.get("/customers/:id", requirePermission("customers.view"), async (c) => {
  const id = intParam(c, "id");
  const cust = await c.env.DB.prepare("SELECT c.*, w.name_fr AS wilaya FROM customers c LEFT JOIN wilayas w ON w.code = c.wilaya_code WHERE c.id = ?")
    .bind(id)
    .first<Record<string, unknown> & RiskCounters & { total_spent: number }>();
  if (!cust) throw new HttpError(404, "not_found");
  const [orders, ledger] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, public_code, status, total, channel, created_at, outcome_reason FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50").bind(id),
    c.env.DB.prepare("SELECT * FROM loyalty_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 50").bind(id),
  ]);
  const h = {
    deliveredCount: cust.delivered_count ?? 0, returnedCount: cust.returned_count ?? 0, cancelledCount: cust.cancelled_count ?? 0,
    fakeCount: cust.fake_count ?? 0, isBlacklisted: !!cust.is_blacklisted,
  };
  return c.json({
    customer: cust,
    orders: orders!.results,
    ledger: ledger!.results,
    risk: assessRisk(h),
    segment: customerSegment({ ...h, totalSpent: cust.total_spent ?? 0 }),
  });
});

customerRoutes.patch("/customers/:id", requirePermission("customers.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(80).pipe(z.string().min(2)).optional(),
      notes: cleanText(2000).nullable().optional(),
      tags: z.array(cleanText(30)).max(10).optional(),
      isBlacklisted: z.boolean().optional(),
      blacklistReason: cleanText(200).nullable().optional(),
    }),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE customers SET name = COALESCE(?, name), notes = CASE WHEN ? THEN ? ELSE notes END, tags = COALESCE(?, tags),
         is_blacklisted = COALESCE(?, is_blacklisted), blacklist_reason = CASE WHEN ? THEN ? ELSE blacklist_reason END WHERE id = ?`,
    ).bind(
      input.name ?? null, "notes" in input ? 1 : 0, input.notes ?? null, input.tags ? JSON.stringify(input.tags) : null,
      input.isBlacklisted == null ? null : input.isBlacklisted ? 1 : 0, "blacklistReason" in input ? 1 : 0, input.blacklistReason ?? null, id,
    ),
    auditStmt(c.env, actorOf(c.get("member")), "update", "customer", id, Object.keys(input)),
  ]);
  return c.json({ ok: true });
});

customerRoutes.post("/customers/:id/points", requirePermission("loyalty.edit"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ delta: z.number().int().min(-100_000).max(100_000), note: cleanText(200).pipe(z.string().min(2)) }));
  const cur = await c.env.DB.prepare("SELECT points_balance FROM customers WHERE id = ?").bind(id).first<{ points_balance: number }>();
  if (!cur) throw new HttpError(404, "not_found");
  if (cur.points_balance + input.delta < 0) throw new HttpError(409, "points_negative");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE customers SET points_balance = points_balance + ? WHERE id = ?").bind(input.delta, id),
    c.env.DB.prepare("INSERT INTO loyalty_ledger (customer_id, delta, reason, actor, note, created_at) VALUES (?, ?, 'manual', ?, ?, ?)").bind(
      id, input.delta, actorOf(c.get("member")), input.note, Date.now(),
    ),
  ]);
  return c.json({ balance: cur.points_balance + input.delta });
});

/* ───────────── Fidélité ───────────── */

customerRoutes.get("/loyalty", requirePermission("loyalty.edit"), async (c) => {
  const [settings, top, stats] = await Promise.all([
    getSetting(c.env, "loyalty"),
    c.env.DB.prepare("SELECT id, name, phone, points_balance, delivered_count, total_spent FROM customers WHERE points_balance > 0 ORDER BY points_balance DESC LIMIT 20").all(),
    c.env.DB.prepare(
      "SELECT COALESCE(SUM(points_balance), 0) AS outstanding, COUNT(CASE WHEN points_balance > 0 THEN 1 END) AS members FROM customers",
    ).first<{ outstanding: number; members: number }>(),
  ]);
  // redeem_value_da = value of ONE point in DA
  return c.json({ settings, top: top.results, stats: { ...stats, liabilityDa: (stats?.outstanding ?? 0) * settings.redeem_value_da } });
});

customerRoutes.put("/loyalty", requirePermission("loyalty.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      enabled: z.boolean(),
      points_per_100da: z.number().int().min(0).max(100),
      redeem_value_da: z.number().int().min(0).max(10000),
      min_redeem: z.number().int().min(0).max(100000),
      expiry_days: z.number().int().min(0).max(3650),
    }),
  );
  await setSetting(c.env, "loyalty", input);
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "loyalty", input)]);
  return c.json(input);
});

/**
 * A customer removed from the list. Her orders stay (sales history) under "Clientes sans
 * fiche"; her loyalty points go with her. A new order from her number starts a new record.
 * `?erase=1`, when she asks for her data to be deleted (law 18-07, the privacy page): her
 * orders keep only what the accounts need (items, amounts, wilaya, dates), her name, phone,
 * address and notes are wiped, and her saved checkouts, messages and stock alerts deleted;
 * her published reviews show "Cliente". The copies go too: notes in the order history, the
 * team's corrections of her name/phone/address, exchange and follow-up notes, alerts about
 * her orders, the parcel photo. The audit log keeps no trace of who she was.
 */
/** Corrections of these order fields hold her personal data (order_changes.field). */
const PERSONAL_FIELDS = "('name', 'phone', 'address', 'commune_id', 'customer_note', 'internal_note')";

customerRoutes.delete("/customers/:id", requireOwner, async (c) => {
  const id = intParam(c, "id");
  const erase = c.req.query("erase") === "1";
  const cust = await c.env.DB.prepare("SELECT id, name, phone FROM customers WHERE id = ?").bind(id).first<{ id: number; name: string; phone: string }>();
  if (!cust || cust.phone === "") throw new HttpError(404, "not_found");
  // her orders (by record or by number), before they are detached from her
  const mine = erase
    ? ((await c.env.DB.prepare("SELECT id, pack_photo FROM orders WHERE customer_id = ?1 OR phone = ?2").bind(id, cust.phone).all<{ id: number; pack_photo: string | null }>())
        .results)
    : [];
  // the parcel photos (her label, her address) leave the storage first: if that fails nothing
  // is wiped yet and the erase can simply be done again (deleting twice is harmless)
  const photos = mine.map((o) => o.pack_photo).filter((k): k is string => !!k);
  if (photos.length) await c.env.MEDIA.delete(photos);
  const ids = JSON.stringify(mine.map((o) => o.id));
  const inMine = "IN (SELECT value FROM json_each(?))";
  const wipe = erase
    ? [
        c.env.DB.prepare(`UPDATE order_events SET note = NULL WHERE order_id ${inMine}`).bind(ids),
        c.env.DB.prepare(
          `UPDATE order_changes SET reason = NULL,
                  old_value = CASE WHEN field IN ${PERSONAL_FIELDS} THEN NULL ELSE old_value END,
                  new_value = CASE WHEN field IN ${PERSONAL_FIELDS} THEN NULL ELSE new_value END
            WHERE order_id ${inMine}`,
        ).bind(ids),
        c.env.DB.prepare(`UPDATE exchange_requests SET note = NULL, decision_note = NULL WHERE order_id ${inMine}`).bind(ids),
        c.env.DB.prepare(`UPDATE delivery_followups SET note = NULL WHERE order_id ${inMine}`).bind(ids),
        c.env.DB.prepare(`UPDATE alerts SET message = 'Données effacées à la demande de la cliente' WHERE (entity = 'order' AND entity_id IN (SELECT CAST(value AS TEXT) FROM json_each(?1))) OR (entity = 'customer' AND entity_id = ?2)`).bind(ids, String(id)),
        c.env.DB.prepare(`UPDATE orders SET pack_photo = NULL WHERE id ${inMine}`).bind(ids),
        c.env.DB.prepare("UPDATE reviews SET name = 'Cliente' WHERE order_id IN (SELECT id FROM orders WHERE customer_id = ?1 OR phone = ?2)").bind(id, cust.phone),
        c.env.DB.prepare(
          `UPDATE orders SET name = 'Cliente effacée', phone = '', address = NULL, customer_note = NULL, internal_note = NULL,
                  ip_hash = NULL, ua_short = NULL, referrer = NULL WHERE customer_id = ?1 OR phone = ?2`,
        ).bind(id, cust.phone),
        c.env.DB.prepare("DELETE FROM contact_messages WHERE phone = ?").bind(cust.phone),
        c.env.DB.prepare("DELETE FROM stock_alerts WHERE phone = ?").bind(cust.phone),
      ]
    : [];
  await c.env.DB.batch([
    ...wipe,
    noRecordCustomerStmt(c.env),
    c.env.DB.prepare("UPDATE orders SET customer_id = (SELECT id FROM customers WHERE phone = '') WHERE customer_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM loyalty_ledger WHERE customer_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(id),
    auditStmt(c.env, actorOf(c.get("member")), erase ? "erase" : "delete", "customer", id, erase ? { erased: true } : { name: cust.name, phone: cust.phone }),
  ]);
  return c.json({ ok: true });
});
