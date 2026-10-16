/**
 * "Delete my data" (law 18-07, promised on the privacy page; audit DATA-3/LEGAL-2): the owner
 * erases a customer's personal data; her orders keep only what the accounts need.
 */
import { describe, expect, it } from "vitest";
import { addOrder, seedShop, testApp, testDb } from "../../test/db";
import { customerRoutes } from "./customers";

describe("erasing a customer's personal data", () => {
  it("wipes name, phone, address and notes from her orders, deletes her messages", async () => {
    const db = testDb();
    seedShop(db);
    const mine = addOrder(db, { customerId: 1, total: 3600 });
    const hers = addOrder(db, { customerId: 2, phone: "0661223344" });
    db.sqlite.exec(`UPDATE orders SET customer_note = 'sonner 2 fois', ip_hash = 'h' WHERE id = ${mine}`);
    db.sqlite.exec(`INSERT INTO contact_messages (name, phone, message) VALUES ('Amina', '0554650718', 'Bonjour')`);

    const app = testApp(customerRoutes, db);
    expect((await app.call("DELETE", "/customers/1?erase=1")).status).toBe(200);

    const o = db.sqlite.prepare("SELECT name, phone, address, customer_note, ip_hash, total, wilaya_code FROM orders WHERE id = ?").get(mine);
    expect(o).toEqual({ name: "Cliente effacée", phone: "", address: null, customer_note: null, ip_hash: null, total: 3600, wilaya_code: 35 });
    expect(db.sqlite.prepare("SELECT name FROM orders WHERE id = ?").get(hers)).toEqual({ name: "Amina" }); // another customer: untouched
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM contact_messages").get()).toEqual({ n: 0 });
    const log = JSON.stringify(db.sqlite.prepare("SELECT * FROM audit_log").all());
    expect(log).not.toContain("0554650718");
  });

  // audit round 2 (R2-2): the copies kept elsewhere — her own address edit in the order's
  // history, the team's corrections, exchange and follow-up notes, alerts, the parcel photo
  it("leaves no copy in the history, notes, alerts or the parcel photo", async () => {
    const db = testDb();
    seedShop(db);
    const mine = addOrder(db, { customerId: 1 });
    const s = db.sqlite;
    s.exec(`INSERT INTO order_events (order_id, kind, actor, source, note, created_at)
      VALUES (${mine}, 'edit', 'customer', 'customer', 'Adresse modifiée par la cliente : « Cité 200 logements bloc B » → « 12 rue des Roses »', 1)`);
    s.exec(`INSERT INTO order_changes (order_id, field, old_value, new_value, reason, actor, created_at)
      VALUES (${mine}, 'phone', '0554650718', '0554650719', 'elle a appelé du 0554650719', 'Ilyas', 1), (${mine}, 'discount', '0', '300', NULL, 'Ilyas', 1)`);
    s.exec(`INSERT INTO exchange_requests (order_id, order_item_id, to_variant_id, reason, note, decision_note) VALUES (${mine}, 1, 2, 'size', 'Amina, livrer au 12 rue des Roses', 'appeler 0554650718')`);
    s.exec(`INSERT INTO delivery_followups (order_id, reason, last_attempt_at, note, created_by) VALUES (${mine}, 'unreachable', 1, 'Amina ne répond pas au 0554650718', 'Ilyas')`);
    s.exec(`INSERT INTO alerts (kind, priority, entity, entity_id, message, dedupe_key) VALUES ('risk', 'high', 'order', '${mine}', 'Amina 0554650718 : 3 retours', 'k1')`);
    s.exec(`UPDATE orders SET pack_photo = 'private/packing/${mine}-abc.jpg' WHERE id = ${mine}`);
    const deleted: string[] = [];
    const MEDIA = { delete: async (k: string | string[]) => void deleted.push(...[k].flat()) };

    expect((await testApp(customerRoutes, db, undefined, { MEDIA } as never).call("DELETE", "/customers/1?erase=1")).status).toBe(200);

    const left = JSON.stringify({
      events: s.prepare("SELECT note FROM order_events WHERE order_id = ?").all(mine),
      changes: s.prepare("SELECT old_value, new_value, reason FROM order_changes WHERE order_id = ?").all(mine),
      exchanges: s.prepare("SELECT note, decision_note FROM exchange_requests").all(),
      followups: s.prepare("SELECT note FROM delivery_followups").all(),
      alerts: s.prepare("SELECT message FROM alerts").all(),
      photo: s.prepare("SELECT pack_photo FROM orders WHERE id = ?").get(mine),
    });
    expect(left).not.toMatch(/Roses|Cité 200|055465071|Amina|packing/);
    expect(deleted).toEqual([`private/packing/${mine}-abc.jpg`]);
    // the accounts keep the amounts
    expect(s.prepare("SELECT old_value, new_value FROM order_changes WHERE field = 'discount'").get()).toEqual({ old_value: "0", new_value: "300" });
  });

  // audit round 3 (R3-2): storage failing must not leave photos nobody can find any more
  it("the parcel photos go first: if storage fails, nothing is wiped and it can be tried again", async () => {
    const db = testDb();
    seedShop(db);
    const mine = addOrder(db, { customerId: 1 });
    db.sqlite.exec(`UPDATE orders SET pack_photo = 'private/packing/${mine}-abc.jpg' WHERE id = ${mine}`);
    let fail = true;
    const deleted: string[] = [];
    const MEDIA = {
      delete: async (k: string | string[]) => {
        if (fail) throw new Error("R2 unavailable");
        deleted.push(...[k].flat());
      },
    };
    const app = testApp(customerRoutes, db, undefined, { MEDIA } as never);
    await expect(app.call("DELETE", "/customers/1?erase=1")).rejects.toThrow(/R2 unavailable/);
    expect(db.sqlite.prepare("SELECT name, pack_photo FROM orders WHERE id = ?").get(mine)).toEqual({ name: "Amina", pack_photo: `private/packing/${mine}-abc.jpg` });

    fail = false; // tried again
    expect((await app.call("DELETE", "/customers/1?erase=1")).status).toBe(200);
    expect(deleted).toEqual([`private/packing/${mine}-abc.jpg`]);
    expect(db.sqlite.prepare("SELECT name, pack_photo FROM orders WHERE id = ?").get(mine)).toEqual({ name: "Cliente effacée", pack_photo: null });
  });

  it("a plain delete still keeps her orders as they were", async () => {
    const db = testDb();
    seedShop(db);
    const mine = addOrder(db, { customerId: 1 });
    expect((await testApp(customerRoutes, db).call("DELETE", "/customers/1")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT phone FROM orders WHERE id = ?").get(mine)).toEqual({ phone: "0554650718" });
  });
});
