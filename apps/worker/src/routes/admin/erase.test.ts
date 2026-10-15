/**
 * "Delete my data" (law 18-07, promised on the privacy page; audit DATA-3/LEGAL-2): the owner
 * erases a customer's personal data; her orders keep only what the accounts need.
 */
import { describe, expect, it } from "vitest";
import { addOrder, seedShop, testApp, testDb } from "../../test/db";
import { customerRoutes } from "./customers";

describe("erasing a customer's personal data", () => {
  it("wipes name, phone, address and notes from her orders, deletes her messages and saved checkouts", async () => {
    const db = testDb();
    seedShop(db);
    const mine = addOrder(db, { customerId: 1, total: 3600 });
    const hers = addOrder(db, { customerId: 2, phone: "0661223344" });
    db.sqlite.exec(`UPDATE orders SET customer_note = 'sonner 2 fois', ip_hash = 'h' WHERE id = ${mine}`);
    db.sqlite.exec(`INSERT INTO carts (id, items, phone, name) VALUES ('c1', '[]', '0554650718', 'Amina'), ('c2', '[]', '0661223344', 'Lina')`);
    db.sqlite.exec(`INSERT INTO contact_messages (name, phone, message) VALUES ('Amina', '0554650718', 'Bonjour')`);

    const app = testApp(customerRoutes, db);
    expect((await app.call("DELETE", "/customers/1?erase=1")).status).toBe(200);

    const o = db.sqlite.prepare("SELECT name, phone, address, customer_note, ip_hash, total, wilaya_code FROM orders WHERE id = ?").get(mine);
    expect(o).toEqual({ name: "Cliente effacée", phone: "", address: null, customer_note: null, ip_hash: null, total: 3600, wilaya_code: 35 });
    expect(db.sqlite.prepare("SELECT name FROM orders WHERE id = ?").get(hers)).toEqual({ name: "Amina" }); // another customer: untouched
    expect(db.sqlite.prepare("SELECT id FROM carts").all()).toEqual([{ id: "c2" }]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM contact_messages").get()).toEqual({ n: 0 });
    const log = JSON.stringify(db.sqlite.prepare("SELECT * FROM audit_log").all());
    expect(log).not.toContain("0554650718");
  });

  it("a plain delete still keeps her orders as they were", async () => {
    const db = testDb();
    seedShop(db);
    const mine = addOrder(db, { customerId: 1 });
    expect((await testApp(customerRoutes, db).call("DELETE", "/customers/1")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT phone FROM orders WHERE id = ?").get(mine)).toEqual({ phone: "0554650718" });
  });
});
