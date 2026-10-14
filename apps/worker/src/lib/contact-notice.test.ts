import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { seedShop, testDb } from "../test/db";
import { encryptSecret } from "./crypto";
import { CONTACT_NOTICE_EVERY, contactDigest, noticeNewContact } from "./contact-notice";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

async function shop() {
  const db = testDb();
  seedShop(db);
  const env = { DB: db, SETTINGS_KEY: KEY } as unknown as Env;
  const token = await encryptSecret(KEY, "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
  db.sqlite.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('telegram', '${JSON.stringify({ token_enc: token, chat_id: "-1001", chat_title: "Équipe", bot_username: "b", webhook_secret_enc: null, webhook_url: null, last_update_id: 0 })}', 0)`);
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/sendMessage")) sent.push(String(JSON.parse(String(init?.body)).text));
    return new Response(JSON.stringify({ ok: true, result: {} }), { headers: { "Content-Type": "application/json" } });
  });
  return { db, env, sent };
}
afterEach(() => vi.unstubAllGlobals());

describe("contact messages → Telegram (audit SEC-2)", () => {
  it("10 messages in a row ring once; the next ones are grouped in one digest after 15 min", async () => {
    const { db, env, sent } = await shop();
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 10; i++) {
      db.sqlite.exec(`INSERT INTO contact_messages (name, message, status, created_at) VALUES ('N${i}', 'bonjour', 'new', ${t0 + i * 1000})`);
      await noticeNewContact(env, `N${i}`, t0 + i * 1000);
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("N0");
    // the cron before 15 min: nothing; after: one message for the 9 others
    expect(await contactDigest(env, t0 + 60_000)).toBe(0);
    expect(await contactDigest(env, t0 + CONTACT_NOTICE_EVERY + 1)).toBe(9);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("9 nouveaux messages");
    // nothing new: no message
    expect(await contactDigest(env, t0 + 3 * CONTACT_NOTICE_EVERY)).toBe(0);
    expect(sent).toHaveLength(2);
  });
});
