/**
 * Invisible bot check for the public forms (order, contact, review, stock alert), with no third
 * party and nothing for the customer to do:
 *  - a hidden field ("hp") that people never see and form-filling bots fill in;
 *  - a signed form ticket, given when the page opens (GET /api/form-ticket): a form is accepted
 *    only with a genuine ticket at least 3 s old (a person needs that long to fill it) and at most
 *    6 h old, and one ticket sends only a few forms (rate limit keyed on the ticket).
 * A script posting straight to the API, replaying old tickets or flooding with one ticket fails;
 * the per-connection and per-phone limits still apply behind it.
 */
import type { Context } from "hono";
import { base64url, timingSafeEqual } from "@henine/shared";
import type { AppEnv, Env } from "../env";
import { HttpError, rateLimit } from "./http";

export const TICKET_MIN_AGE_MS = 3_000;
const TICKET_MAX_AGE_MS = 6 * 3_600_000;

async function sign(env: Env, issuedAt: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`form-ticket|${env.IP_HASH_SALT}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(issuedAt)));
  return base64url(new Uint8Array(mac)).slice(0, 32);
}

/** A fresh ticket: "<issued at>.<signature>". */
export async function issueTicket(env: Env, now = Date.now()): Promise<{ ticket: string; issuedAt: number; minAgeMs: number }> {
  return { ticket: `${now}.${await sign(env, now)}`, issuedAt: now, minAgeMs: TICKET_MIN_AGE_MS };
}

/** Refuses a form sent by a bot (the error tells the store to take a new ticket and resend). */
export async function checkFormGuard(c: Context<AppEnv>, guard: { ticket?: string; hp?: string } | undefined, now = Date.now()): Promise<void> {
  // the hidden field is filled: a bot (answered like an expired ticket, nothing to learn)
  if (guard?.hp) throw new HttpError(403, "form_expired");
  const [at, mac] = (guard?.ticket ?? "").split(".");
  const issuedAt = Number(at);
  if (!at || !mac || !Number.isFinite(issuedAt) || !timingSafeEqual(mac, await sign(c.env, issuedAt))) throw new HttpError(403, "form_expired");
  const age = now - issuedAt;
  if (age < TICKET_MIN_AGE_MS || age > TICKET_MAX_AGE_MS) throw new HttpError(403, "form_expired");
  // one ticket sends a handful of forms, not a flood
  await rateLimit(c.env.RL_WRITE, `ticket:${mac}`);
}
