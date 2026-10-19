/**
 * Admin → Contact: the messages inbox and the store's contact details.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { body, intParam } from "../../lib/http";
import { bumpCatalogStmt, getSettings, setSettingStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";

export const contactRoutes = new Hono<AppEnv>();

/* ───────────── Contact: inbox + store contact details ───────────── */

contactRoutes.get("/contact", requirePermission("contact.view"), async (c) => {
  const status = c.req.query("status") ?? "open";
  const where = status === "open" ? "WHERE status IN ('new','in_progress')" : status === "all" ? "" : "WHERE status = ?";
  const [rows, s] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM contact_messages ${where} ORDER BY created_at DESC LIMIT 100`)
      .bind(...(where.includes("?") ? [status] : []))
      .all(),
    getSettings(c.env, ["contact", "store"]),
  ]);
  return c.json({ rows: rows.results, contact: s.contact, store: s.store });
});

contactRoutes.patch("/contact/:id", requirePermission("contact.view"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(c, z.object({ status: z.enum(["new", "in_progress", "done", "spam"]) }));
  await c.env.DB.prepare("UPDATE contact_messages SET status = ?, handled_by = ? WHERE id = ?").bind(input.status, c.get("member").id, id).run();
  return c.json({ ok: true });
});

const optUrl = z.string().trim().max(300).nullable().refine((v) => !v || /^https:\/\//.test(v), "https_required");
contactRoutes.put("/contact/settings", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      contact: z.object({
        phone: cleanText(20).nullable(), whatsapp: cleanText(20).nullable(), instagram: optUrl, tiktok: optUrl, facebook: optUrl, maps: optUrl,
        followers: cleanText(12).nullable().optional(),
      }),
    }),
  );
  const { contact } = await getSettings(c.env, ["contact"]);
  await c.env.DB.batch([
    setSettingStmt(c.env, "contact", { ...contact, ...input.contact }),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "contact"),
  ]);
  return c.json({ ok: true });
});
