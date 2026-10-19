/**
 * Admin → Notifier: team notifications, the back-in-stock waitlist, and news sent to the
 * customers who subscribed.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { variantLabels } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { getSettings, setSettingStmt } from "../../lib/settings";
import { sendCampaignBatch } from "../../lib/webpush";
import { actorOf, requirePermission } from "../../middleware/access";

export const notifierRoutes = new Hono<AppEnv>();

/* ───────────── Notifier: team notifications + back-in-stock waitlists ───────────── */

notifierRoutes.get("/notifier", requirePermission("marketing.edit"), async (c) => {
  const { notifications } = await getSettings(c.env, ["notifications"]);
  const [subs, campaigns] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions s WHERE EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = 'news')"),
    c.env.DB.prepare("SELECT id, title, status, stats, created_at FROM campaigns WHERE kind = 'push' ORDER BY id DESC LIMIT 10"),
  ]);
  const { results } = await c.env.DB.prepare(
    `SELECT a.variant_id, v.sku, p.name_fr, p.id AS product_id, v.stock_on_hand - v.stock_reserved AS available,
            COUNT(*) AS waiting, SUM(CASE WHEN a.push_subscription_id IS NOT NULL THEN 1 ELSE 0 END) AS push_waiting,
            GROUP_CONCAT(a.phone, ', ') AS phones, MAX(a.created_at) AS last_at
       FROM stock_alerts a JOIN variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id
      WHERE a.notified_at IS NULL GROUP BY a.variant_id ORDER BY waiting DESC LIMIT 100`,
  ).all<{ variant_id: number } & Record<string, unknown>>();
  const labels = await variantLabels(c.env, results.map((r) => r.variant_id));
  return c.json({
    notifications,
    waitlists: results.map((r) => ({ ...r, options: labels.get(r.variant_id)?.fr ?? "" })),
    newsSubscribers: (subs!.results[0] as { n: number }).n,
    campaigns: (campaigns!.results as { stats: string | null }[]).map((r) => ({ ...r, stats: JSON.parse(r.stats ?? "{}") })),
  });
});

notifierRoutes.put("/notifier/settings", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      telegram_new_order: z.boolean(), telegram_status_change: z.boolean(), telegram_low_stock: z.boolean(),
      telegram_review: z.boolean(), telegram_contact: z.boolean(), trust_group_members: z.boolean(),
    }),
  );
  await c.env.DB.batch([setSettingStmt(c.env, "notifications", input), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "notifications", input)]);
  return c.json(input);
});

notifierRoutes.post("/notifier/waitlist/:variantId/notified", requirePermission("marketing.edit"), async (c) => {
  const variantId = intParam(c, "variantId");
  const res = await c.env.DB.prepare("UPDATE stock_alerts SET notified_at = ? WHERE variant_id = ? AND notified_at IS NULL").bind(Date.now(), variantId).run();
  return c.json({ notified: res.meta.changes });
});

/* ───────────── Notifications to subscribers ("Recevoir les nouveautés") ───────────── */

notifierRoutes.post("/notifier/broadcast", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      titleFr: cleanText(60).pipe(z.string().min(2)),
      titleAr: cleanText(60).pipe(z.string().min(2)),
      bodyFr: cleanText(160).pipe(z.string().min(2)),
      bodyAr: cleanText(160).pipe(z.string().min(2)),
      /** page of the store it opens ("/c/robes", "/produit/…") */
      // a page of this shop only: "//other.site" or "/\other.site" would open another website
      path: z.string().trim().max(200).regex(/^\/(?![/\\])[^\s]*$/).default("/"),
    }),
  );
  const running = await c.env.DB.prepare("SELECT id FROM campaigns WHERE kind = 'push' AND status = 'sending'").first();
  if (running) throw new HttpError(409, "campaign_running");
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions s WHERE EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = 'news')").first<{ n: number }>();
  if (!total?.n) throw new HttpError(409, "no_subscribers");
  const row = await c.env.DB.prepare(
    "INSERT INTO campaigns (kind, title, config, status, stats, created_at) VALUES ('push', ?, ?, 'sending', ?, ?) RETURNING id",
  )
    .bind(input.titleFr, JSON.stringify(input), JSON.stringify({ total: total.n, sent: 0, failed: 0, cursor: 0 }), Date.now())
    .first<{ id: number }>();
  await auditStmt(c.env, actorOf(c.get("member")), "create", "campaign", row!.id, { title: input.titleFr }).run();
  // first batch now, the rest every 5 minutes (cron) — free plan: ≤ 50 sub-requests per run
  c.executionCtx.waitUntil(sendCampaignBatch(c.env, 35).catch(() => undefined));
  return c.json({ id: row!.id, total: total.n }, 201);
});
