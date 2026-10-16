/**
 * Two pieces with the same name (or an old draft with it): the new one gets the next free
 * address (karim-2) instead of « adresse déjà utilisée ». An address typed by hand stays exact.
 */
import { describe, expect, it } from "vitest";
import { seedShop, testApp, testDb } from "../../test/db";
import { catalogRoutes } from "./catalog";

const piece = (over: Record<string, unknown> = {}) => ({
  nameFr: "Karim", nameAr: "كريم", status: "draft", categoryId: null, price: 5000, options: [], variants: [{ refs: [], stockOnHand: 5 }], ...over,
});

describe("product address (slug)", () => {
  it("same name twice: karim, then karim-2", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(catalogRoutes, db);
    const a = await app.call<{ slug: string }>("POST", "/products", piece());
    const b = await app.call<{ slug: string }>("POST", "/products", piece());
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.slug, b.body.slug]).toEqual(["karim", "karim-2"]);
  });

  it("a taken address typed by hand is refused", async () => {
    const db = testDb();
    seedShop(db);
    const app = testApp(catalogRoutes, db);
    await app.call("POST", "/products", piece());
    expect((await app.call("POST", "/products", piece({ nameFr: "Autre", slug: "karim" }))).body).toEqual({ error: "slug_taken" });
  });
});
