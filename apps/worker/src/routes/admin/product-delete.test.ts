/**
 * Deleting a product (« Supprimer »): one counted in an inventory used to fail with « FOREIGN KEY
 * constraint failed »; it now goes, with its count lines. One already sold — even only through
 * one of its sizes — is archived instead, so the orders keep their history.
 */
import { describe, expect, it } from "vitest";
import { addOrder, seedShop, testApp, testDb } from "../../test/db";
import { catalogRoutes } from "./catalog";

describe("deleting a product", () => {
  it("counted in an inventory, never sold: deleted with its count lines", async () => {
    const db = testDb();
    seedShop(db);
    db.sqlite.exec(`INSERT INTO stock_counts (id, scope, title, created_by) VALUES (1, 'all', 'Inventaire', 'Ilyas');
      INSERT INTO stock_count_lines (count_id, variant_id, system_qty) VALUES (1, 1, 20), (1, 2, 10)`);
    const res = await testApp(catalogRoutes, db).call("DELETE", "/products/1");
    expect(res.body).toEqual({ deleted: true });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM products WHERE id = 1").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_count_lines").get()).toEqual({ n: 0 });
  });

  it("sold once: archived, not deleted", async () => {
    const db = testDb();
    seedShop(db);
    addOrder(db, { items: [{ variantId: 2, qty: 1 }] });
    expect((await testApp(catalogRoutes, db).call("DELETE", "/products/1")).body).toEqual({ archived: true });
    expect(db.sqlite.prepare("SELECT status FROM products WHERE id = 1").get()).toEqual({ status: "archived" });
  });
});
