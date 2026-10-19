import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { addOrder, seedShop, testDb } from "../test/db";
import { encryptSecret } from "./crypto";
import { handleUpdate } from "./telegram";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const GROUP = -1001;

async function shop() {
  const db = testDb();
  seedShop(db);
  const env = { DB: db, SETTINGS_KEY: KEY, PUBLIC_ORIGIN: "https://shop.example" } as unknown as Env;
  const token = await encryptSecret(KEY, "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
  db.sqlite.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('telegram', '${JSON.stringify({ token_enc: token, chat_id: String(GROUP), chat_title: "Équipe", bot_username: "elfatina_bot", webhook_secret_enc: null, webhook_url: null, last_update_id: 0 })}', 0)`);
  return { db, env };
}

/** every message the bot sends, captured instead of reaching Telegram */
function captureTelegram() {
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/sendMessage")) sent.push(String(JSON.parse(String(init?.body)).text));
    return new Response(JSON.stringify({ ok: true, result: {} }), { headers: { "Content-Type": "application/json" } });
  });
  return sent;
}
const command = (text: string, from: number, chat: number) => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: chat < 0 ? "supergroup" : "private" }, from: { id: from, first_name: "X" }, text } });

afterEach(() => vi.unstubAllGlobals());

describe("Telegram bot commands", () => {
  it("a stranger writing to the bot gets no customer data nor figures", async () => {
    const { env } = await shop();
    const sent = captureTelegram();
    for (const c of ["/chercher 0554", "/cmd EF-T1", "/jour", "/semaine", "/attente", "/stock"]) await handleUpdate(env, command(c, 999, 999) as never);
    expect(sent).toHaveLength(6);
    for (const m of sent) expect(m).toContain("⛔");
    // /id stays open: it is how a member finds their Telegram id
    await handleUpdate(env, command("/id", 999, 999) as never);
    expect(sent.at(-1)).toContain("999");
  });

  it("a linked member with the right permission is answered; a deactivated one is refused even in the group", async () => {
    const { db, env } = await shop();
    const sent = captureTelegram();
    db.sqlite.exec("INSERT INTO team_members (id, email, name, role_id, is_active, telegram_user_id, created_at) VALUES (50, 'stock@shop.dz', 'Stock', (SELECT id FROM roles WHERE key = 'owner'), 1, 42, 0)");
    await handleUpdate(env, command("/stock", 42, 42) as never);
    expect(sent.at(-1)).not.toContain("⛔");
    db.sqlite.exec("UPDATE settings SET value = json_set(value, '$.trust_group_members', json('true')) WHERE key = 'notifications'");
    db.sqlite.exec("UPDATE team_members SET is_active = 0 WHERE id = 50");
    await handleUpdate(env, command("/stock", 42, GROUP) as never);
    expect(sent.at(-1)).toContain("désactivé");
  });

  it("an unlinked member of the team group never bypasses roles (audit SEC-001)", async () => {
    const { db, env } = await shop();
    const answers: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/answerCallbackQuery")) answers.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), { headers: { "Content-Type": "application/json" } });
    });
    const id = addOrder(db, { status: "nouvelle" });
    const press = (to: string) =>
      handleUpdate(env, { update_id: 1, callback_query: { id: "cb", from: { id: 777, first_name: "Livreur" }, data: `s:${id}:${to}`, message: { chat: { id: GROUP }, message_id: 5 } } } as never);
    const status = () => (db.sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(id) as { status: string }).status;

    // default: the group is not trusted, nothing goes through
    await press("confirmee");
    expect(answers.at(-1)).toContain("⛔");
    expect(status()).toBe("nouvelle");

    // trusted group: cancelling / fake / shipping still refused, only the reversible first step
    db.sqlite.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('notifications', '{"trust_group_members":true}', 0)`);
    for (const to of ["annulee", "fausse", "doublon", "expediee", "livree"]) {
      await press(to);
      expect(answers.at(-1)).toContain("⛔");
    }
    expect(status()).toBe("nouvelle");
    await press("confirmee");
    expect(status()).toBe("confirmee");
    expect((db.sqlite.prepare("SELECT actor FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 1").get(id) as { actor: string }).actor).toMatch(/^telegram:777:/);
  });
});
