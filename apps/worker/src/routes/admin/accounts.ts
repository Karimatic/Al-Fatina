/**
 * Admin → Comptes: my account (name, password, recovery codes, devices) and the integrations
 * (Telegram, ZR Express, pixels, email).
 */
import { Hono } from "hono";
import { newRecoveryCodes, recoveryLeft } from "../../lib/recovery";
import { z } from "zod";
import { cleanText } from "@henine/shared";
import type { AppEnv, Env } from "../../env";
import { isDev } from "../../env";
import { auditStmt } from "../../lib/audit";
import { checkPassword, devEcho, hashPassword, passwordKeyValid } from "../../lib/auth";
import { decryptSecret, encryptSecret, maskSecret, randomToken } from "../../lib/crypto";
import { body, HttpError, intParam, rateLimit } from "../../lib/http";
import { mailLayout, mailProvider, sendMail } from "../../lib/mail";
import { bumpCatalogStmt, getSettings, patchSetting } from "../../lib/settings";
import { processOutbox, sendTelegramText, telegramConfig, tgCall } from "../../lib/telegram";
import { actorOf, requirePermission } from "../../middleware/access";

export const accountRoutes = new Hono<AppEnv>();

/* ───────────── Comptes: my account + integrations ───────────── */

accountRoutes.get("/account", async (c) => {
  const m = c.get("member");
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_agent, created_at, last_seen_at, expires_at FROM admin_sessions WHERE member_id = ? AND expires_at > ? ORDER BY last_seen_at DESC",
  )
    .bind(m.id, Date.now())
    .all<{ id: number }>();
  const rec = await c.env.DB.prepare("SELECT recovery_codes, totp_secret_enc IS NOT NULL AS totp FROM team_members WHERE id = ?").bind(m.id).first<{ recovery_codes: string | null; totp: number }>();
  return c.json({
    member: { id: m.id, email: m.email, name: m.name, roleName: m.roleName },
    sessions: results.map((s) => ({ ...s, current: s.id === m.sessionId })),
    /** recovery codes still usable, and whether she signs in with an authenticator app */
    recovery: { left: recoveryLeft(rec?.recovery_codes ?? null), totp: !!rec?.totp },
  });
});

/**
 * New recovery codes (the old ones stop working), after re-entering the password: shown once,
 * to keep somewhere safe (paper, another phone). Each signs in once if the phone is lost.
 */
accountRoutes.post("/account/recovery-codes", async (c) => {
  const m = c.get("member");
  await rateLimit(c.env.RL_AUTH, `password:${m.id}`);
  const input = await body(c, z.object({ currentKey: z.string().refine(passwordKeyValid) }));
  const row = await c.env.DB.prepare("SELECT password_hash, password_salt FROM team_members WHERE id = ?").bind(m.id).first<{ password_hash: string | null; password_salt: string | null }>();
  if (!(await checkPassword(c.env, input.currentKey, row?.password_hash ?? null, row?.password_salt ?? null))) throw new HttpError(403, "wrong_password");
  const { codes, stored } = await newRecoveryCodes(c.env);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_members SET recovery_codes = ? WHERE id = ?").bind(stored, m.id),
    auditStmt(c.env, actorOf(m), "update", "recovery_codes", m.id),
  ]);
  return c.json({ codes });
});

/** Anyone changes the name the team sees (orders history, Telegram, the welcome line). */
accountRoutes.post("/account/name", async (c) => {
  const m = c.get("member");
  const { name } = await body(c, z.object({ name: cleanText(60).pipe(z.string().min(2)) }));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_members SET name = ? WHERE id = ?").bind(name, m.id),
    auditStmt(c.env, actorOf(m), "update", "team_member", m.id, { name: { from: m.name, to: name } }),
  ]);
  return c.json({ name });
});

accountRoutes.post("/account/password", async (c) => {
  const m = c.get("member");
  // the current password is checked here too: same brute-force limit as the login
  await rateLimit(c.env.RL_AUTH, `password:${m.id}`);
  const input = await body(c, z.object({ currentKey: z.string().refine(passwordKeyValid), newKey: z.string().refine(passwordKeyValid) }));
  const row = await c.env.DB.prepare("SELECT password_hash, password_salt FROM team_members WHERE id = ?").bind(m.id).first<{ password_hash: string | null; password_salt: string | null }>();
  if (!(await checkPassword(c.env, input.currentKey, row?.password_hash ?? null, row?.password_salt ?? null))) throw new HttpError(403, "wrong_password");
  const { hash, salt } = await hashPassword(c.env, input.newKey);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_members SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, m.id),
    // sign out every other device
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ? AND id != ?").bind(m.id, m.sessionId),
    auditStmt(c.env, actorOf(m), "password_change", "team_member", m.id),
  ]);
  return c.json({ ok: true });
});

accountRoutes.delete("/account/sessions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM admin_sessions WHERE id = ? AND member_id = ?").bind(intParam(c, "id"), c.get("member").id).run();
  return c.json({ ok: true });
});

accountRoutes.get("/integrations", requirePermission("integrations.manage"), async (c) => {
  const tg = await telegramConfig(c.env);
  const s = await getSettings(c.env, ["integrations", "notifications"]);
  const zrId = await decryptSecret(c.env.SETTINGS_KEY, s.integrations.zr_id_enc);
  return c.json({
    telegram: {
      tokenMasked: maskSecret(tg.token), botUsername: tg.bot_username, chatId: tg.chat_id, chatTitle: tg.chat_title,
      webhookUrl: tg.webhook_url, mode: isDev(c.env) ? "poll" : tg.webhook_url ? "webhook" : "none", trustGroup: s.notifications.trust_group_members,
    },
    mail: { provider: mailProvider(c.env), from: c.env.MAIL_FROM ?? null },
    zr: { configured: !!zrId, idMasked: maskSecret(zrId) },
    pixels: { metaPixelId: s.integrations.meta_pixel_id, tiktokPixelId: s.integrations.tiktok_pixel_id },
    publicOrigin: c.env.PUBLIC_ORIGIN,
  });
});

accountRoutes.post("/integrations/telegram/token", requirePermission("integrations.manage"), async (c) => {
  const { token } = await body(c, z.object({ token: z.string().trim().regex(/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/, "token_format") }));
  const me = await tgCall<{ username: string }>(token, "getMe");
  if (!me.ok) throw new HttpError(422, "telegram_token_rejected", { description: me.description });
  await patchSetting(c.env, "telegram", { token_enc: await encryptSecret(c.env.SETTINGS_KEY, token), bot_username: me.result!.username, last_update_id: 0 });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "telegram_token")]);
  return c.json({ botUsername: me.result!.username });
});

/** Telegram webhook for the order buttons (✅ confirm, 📵 no answer…), on the live site. */
async function enableTelegramWebhook(env: Env, token: string): Promise<string> {
  const secret = randomToken(24);
  const url = `${env.PUBLIC_ORIGIN}/api/tg/webhook`;
  const res = await tgCall(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  if (!res.ok) throw new HttpError(409, "telegram_error", { description: res.description });
  await patchSetting(env, "telegram", { webhook_secret_enc: await encryptSecret(env.SETTINGS_KEY, secret), webhook_url: url });
  return url;
}

accountRoutes.post("/integrations/telegram/detect", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (!cfg.token) throw new HttpError(409, "telegram_token_missing");
  // Telegram refuses to list the chats while the buttons' webhook is on: switch it off for the
  // search (it is switched back on as soon as a chat is chosen)
  if (cfg.webhook_url) {
    await tgCall(cfg.token, "deleteWebhook", { drop_pending_updates: false });
    await patchSetting(c.env, "telegram", { webhook_url: null, webhook_secret_enc: null });
  } else {
    const info = await tgCall<{ url: string }>(cfg.token, "getWebhookInfo");
    if (info.ok && info.result?.url) await tgCall(cfg.token, "deleteWebhook", { drop_pending_updates: false });
  }
  const res = await tgCall<{ message?: { chat: { id: number; title?: string; type: string; first_name?: string } }; my_chat_member?: { chat: { id: number; title?: string; type: string } } }[]>(
    cfg.token,
    "getUpdates",
    { limit: 100, timeout: 0 },
  );
  if (!res.ok) throw new HttpError(409, "telegram_error", { description: res.description });
  const chats = new Map<number, { id: number; title: string; type: string }>();
  for (const u of res.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat;
    if (chat) chats.set(chat.id, { id: chat.id, title: chat.title ?? (u.message?.chat.first_name ?? "Discussion privée"), type: chat.type });
  }
  return c.json([...chats.values()]);
});

accountRoutes.post("/integrations/telegram/chat", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ chatId: z.string().trim().regex(/^-?\d{3,20}$/), chatTitle: cleanText(80).optional() }));
  await patchSetting(c.env, "telegram", { chat_id: input.chatId, chat_title: input.chatTitle ?? null });
  // the orders that could not be posted while no chat was chosen (last 2 days) go out now
  await c.env.DB.batch([
    auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "telegram_chat"),
    c.env.DB.prepare("UPDATE outbox SET attempts = 0, next_attempt_at = ?, last_error = NULL WHERE kind = 'telegram' AND done_at IS NULL AND created_at > ?").bind(Date.now(), Date.now() - 2 * 86400_000),
  ]);
  const cfg = await telegramConfig(c.env);
  // the order buttons work right away on the live site
  let webhookUrl: string | null = null;
  if (cfg.token && c.env.PUBLIC_ORIGIN.startsWith("https://")) webhookUrl = await enableTelegramWebhook(c.env, cfg.token).catch(() => null);
  const tested = await sendTelegramText(c.env, `🌸 Henine Boutique : ce groupe reçoit maintenant les nouvelles commandes.`);
  c.executionCtx.waitUntil(processOutbox(c.env, 20).catch(() => 0));
  return c.json({ ok: true, tested, webhookUrl });
});

accountRoutes.post("/integrations/telegram/test", requirePermission("integrations.manage"), async (c) => {
  const ok = await sendTelegramText(c.env, `🌸 Test Henine Boutique : les commandes arriveront ici.\nEnvoyé par ${c.get("member").name.replace(/[<>&]/g, "")}.`);
  if (!ok) throw new HttpError(409, "telegram_test_failed");
  return c.json({ ok: true });
});

accountRoutes.post("/integrations/telegram/webhook", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (!cfg.token) throw new HttpError(409, "telegram_token_missing");
  if (!c.env.PUBLIC_ORIGIN.startsWith("https://")) throw new HttpError(409, "https_required");
  return c.json({ webhookUrl: await enableTelegramWebhook(c.env, cfg.token) });
});

accountRoutes.delete("/integrations/telegram", requirePermission("integrations.manage"), async (c) => {
  const cfg = await telegramConfig(c.env);
  if (cfg.token && cfg.webhook_url) await tgCall(cfg.token, "deleteWebhook");
  await patchSetting(c.env, "telegram", { token_enc: null, chat_id: null, chat_title: null, bot_username: null, webhook_secret_enc: null, webhook_url: null, last_update_id: 0 });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "delete", "integration", "telegram")]);
  return c.json({ ok: true });
});

accountRoutes.put("/integrations/zr", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ id: z.string().trim().min(3).max(120), token: z.string().trim().min(8).max(300) }));
  await patchSetting(c.env, "integrations", {
    zr_id_enc: await encryptSecret(c.env.SETTINGS_KEY, input.id),
    zr_token_enc: await encryptSecret(c.env.SETTINGS_KEY, input.token),
  });
  await c.env.DB.batch([auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "zr_express")]);
  return c.json({ ok: true });
});

accountRoutes.put("/integrations/pixels", requirePermission("integrations.manage"), async (c) => {
  const input = await body(c, z.object({ metaPixelId: z.string().regex(/^\d{5,20}$/).nullable(), tiktokPixelId: z.string().regex(/^[A-Z0-9]{5,30}$/).nullable() }));
  await patchSetting(c.env, "integrations", { meta_pixel_id: input.metaPixelId, tiktok_pixel_id: input.tiktokPixelId });
  // the store reads them from /api/site: a new version so its cache follows at once
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "integration", "pixels", input)]);
  return c.json({ ok: true });
});

accountRoutes.post("/integrations/mail/test", requirePermission("integrations.manage"), async (c) => {
  const m = c.get("member");
  const res = await sendMail(c.env, {
    to: m.email,
    subject: "Test d'envoi Henine Boutique",
    text: "Si vous lisez ceci, l'envoi d'emails fonctionne.",
    html: mailLayout("Test d'envoi", ["Si vous lisez ceci, l'envoi d'emails fonctionne. 🌸"]),
  });
  return c.json({ ...res, devNote: devEcho(c, "Mode développement : aucun email réel n'est envoyé (voir la console du serveur).") });
});
