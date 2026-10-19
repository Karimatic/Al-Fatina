/**
 * Recovery codes: 8 one-time codes ("K7Q2M-9XW4H"), shown once when the authenticator app is set
 * up (or renewed in Mon compte). Each replaces the app's 6-digit code for one sign-in, so a lost
 * phone does not lock the shop out. Only peppered hashes are stored.
 */
import { sha256Hex, timingSafeEqual } from "@elfatina/shared";
import type { Env } from "../env";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
export const RECOVERY_CODE = /^[2-9A-HJ-NP-Z]{5}-?[2-9A-HJ-NP-Z]{5}$/i;

const normalize = (code: string) => code.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
const hashOf = (env: Env, code: string) => sha256Hex(normalize(code), `${env.AUTH_PEPPER}|recovery|`);

function oneCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** New codes for a member: the plain codes (shown once) and what to store. */
export async function newRecoveryCodes(env: Env, count = 8): Promise<{ codes: string[]; stored: string }> {
  const codes = Array.from({ length: count }, oneCode);
  return { codes, stored: JSON.stringify(await Promise.all(codes.map((c) => hashOf(env, c)))) };
}

/** Uses one code: true and the remaining list when it matches (each code works once). */
export async function useRecoveryCode(env: Env, stored: string | null, code: string): Promise<{ ok: boolean; remaining: string | null }> {
  if (!stored || !RECOVERY_CODE.test(code.trim())) return { ok: false, remaining: stored };
  const hashes = JSON.parse(stored) as string[];
  const h = await hashOf(env, code);
  const i = hashes.findIndex((x) => timingSafeEqual(x, h));
  if (i < 0) return { ok: false, remaining: stored };
  hashes.splice(i, 1);
  return { ok: true, remaining: JSON.stringify(hashes) };
}

export const recoveryLeft = (stored: string | null) => (stored ? (JSON.parse(stored) as string[]).length : 0);
