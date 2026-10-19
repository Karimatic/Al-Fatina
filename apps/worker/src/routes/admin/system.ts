/**
 * Admin: who I am (/me), the development Telegram poll, and Erreurs (errors, audit log,
 * notification outbox).
 */
import { Hono } from "hono";
import { z } from "zod";
import { hasPermission } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { isDev } from "../../env";
import { body, HttpError, intParam } from "../../lib/http";
import { getSetting } from "../../lib/settings";
import { pollUpdates, processOutbox } from "../../lib/telegram";
import { requirePermission } from "../../middleware/access";

export const systemRoutes = new Hono<AppEnv>();

/* ───────────── Me ───────────── */

systemRoutes.get("/me", async (c) => {
  const m = c.get("member");
  const tg = await getSetting(c.env, "telegram");
  return c.json({
    id: m.id, email: m.email, name: m.name, role: m.role, roleName: m.roleName, permissions: m.permissions,
    dev: isDev(c.env), telegramConfigured: !!(tg.token_enc && tg.chat_id),
  });
});

/** Development only: the admin panel calls this every few seconds to receive Telegram button presses. */
systemRoutes.post("/dev/telegram-poll", async (c) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  const updates = await pollUpdates(c.env);
  const sent = await processOutbox(c.env, 5);
  return c.json({ updates, sent });
});

/* ───────────── Erreurs, journal, outbox ───────────── */

systemRoutes.get("/errors", requirePermission("errors.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  // the team's activity log is its own permission (who did what, with the changes)
  const seeAudit = hasPermission(c.get("member").permissions, "audit.view");
  const [errors, outbox, audit] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM error_events ${status === "all" ? "" : "WHERE status = ?"} ORDER BY last_seen DESC LIMIT 100`).bind(...(status === "all" ? [] : [status])),
    c.env.DB.prepare("SELECT id, kind, payload, attempts, last_error, next_attempt_at, created_at FROM outbox WHERE done_at IS NULL ORDER BY id DESC LIMIT 50"),
    c.env.DB.prepare(`SELECT * FROM audit_log ${seeAudit ? "" : "WHERE 0"} ORDER BY id DESC LIMIT 100`),
  ]);
  return c.json({ errors: errors!.results, outbox: outbox!.results, audit: seeAudit ? audit!.results : null });
});

systemRoutes.patch("/errors/:id", requirePermission("errors.view"), async (c) => {
  const input = await body(c, z.object({ status: z.enum(["open", "resolved", "ignored"]) }));
  await c.env.DB.prepare("UPDATE error_events SET status = ? WHERE id = ?").bind(input.status, intParam(c, "id")).run();
  return c.json({ ok: true });
});

// re-sending messages (Telegram…) is managing the connections, not just reading errors
systemRoutes.post("/outbox/:id/retry", requirePermission("integrations.manage"), async (c) => {
  await c.env.DB.prepare("UPDATE outbox SET next_attempt_at = 0, attempts = MIN(attempts, 7) WHERE id = ? AND done_at IS NULL").bind(intParam(c, "id")).run();
  const sent = await processOutbox(c.env, 5);
  return c.json({ sent });
});
