import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { checkFormGuard, issueTicket, TICKET_MIN_AGE_MS } from "./form-guard";

const env = { IP_HASH_SALT: "salt-for-tests" } as unknown as Env;
const app = new Hono<AppEnv>();
app.post("/check", async (c) => {
  const { guard, now } = (await c.req.json()) as { guard?: { ticket: string; hp?: string }; now: number };
  try {
    await checkFormGuard(c, guard, now);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as { code?: string }).code }, 403);
  }
});
const check = async (guard: unknown, now: number) =>
  (await app.request("/check", { method: "POST", body: JSON.stringify({ guard, now }), headers: { "Content-Type": "application/json" } }, env)).status;

describe("invisible bot check of the public forms", () => {
  it("accepts a genuine ticket once it is a few seconds old", async () => {
    const t = await issueTicket(env, 1_000_000);
    expect(await check({ ticket: t.ticket }, 1_000_000 + TICKET_MIN_AGE_MS + 10)).toBe(200);
  });

  it("refuses: no ticket, a forged one, one sent too fast, a stale one, the hidden field filled", async () => {
    const t = await issueTicket(env, 1_000_000);
    expect(await check(undefined, 1_010_000)).toBe(403);
    expect(await check({ ticket: "1000000.forgedforgedforgedforgedforged12" }, 1_010_000)).toBe(403);
    expect(await check({ ticket: t.ticket }, 1_000_500)).toBe(403); // half a second: a script
    expect(await check({ ticket: t.ticket }, 1_000_000 + 7 * 3_600_000)).toBe(403);
    expect(await check({ ticket: t.ticket, hp: "https://spam.example" }, 1_010_000)).toBe(403);
    // a ticket signed with another key (another site / a guessed secret)
    const other = await issueTicket({ IP_HASH_SALT: "other" } as unknown as Env, 1_000_000);
    expect(await check({ ticket: other.ticket }, 1_010_000)).toBe(403);
  });
});
