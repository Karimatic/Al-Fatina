/**
 * Contact messages → the team's Telegram, at most once per 15 minutes (audit SEC-2): the first
 * message rings at once; the ones that follow are announced together by the 5-minute cron
 * ("✉️ 3 nouveaux messages"). A flood of the contact form can't buzz the owner's phone.
 */
import type { Env } from "../env";
import { getSetting, setSettingStmt } from "./settings";
import { sendTelegramText } from "./telegram";

export const CONTACT_NOTICE_EVERY = 15 * 60_000;

/** A message has just arrived: announce it now unless one was announced in the last 15 min. */
export async function noticeNewContact(env: Env, name: string, now = Date.now()): Promise<boolean> {
  const notif = await getSetting(env, "notifications");
  if (!notif.telegram_contact) return false;
  const last = (await getSetting(env, "contact_notice")).at;
  if (now - last < CONTACT_NOTICE_EVERY) return false; // the cron groups it with the next ones
  await env.DB.batch([setSettingStmt(env, "contact_notice", { at: now })]);
  await sendTelegramText(env, `✉️ Nouveau message de ${name.replace(/[<>&]/g, "")} — Admin → Contact.`);
  return true;
}

/** Cron: the messages that arrived since the last notice, in one message, once 15 min have passed. */
export async function contactDigest(env: Env, now = Date.now()): Promise<number> {
  const notif = await getSetting(env, "notifications");
  if (!notif.telegram_contact) return 0;
  const last = (await getSetting(env, "contact_notice")).at;
  if (now - last < CONTACT_NOTICE_EVERY) return 0;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE created_at > ? AND status = 'new'").bind(last).first<{ n: number }>())?.n ?? 0;
  if (!n) return 0;
  await env.DB.batch([setSettingStmt(env, "contact_notice", { at: now })]);
  await sendTelegramText(env, n === 1 ? "✉️ 1 nouveau message — Admin → Contact." : `✉️ ${n} nouveaux messages — Admin → Contact.`);
  return n;
}
