/** Order lookup (audit ORD-5): a phone number alone never shows what she bought. */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { addOrder, seedShop, testDb } from "../test/db";
import { publicRoutes } from "./public";

describe("order lookup privacy", () => {
  it("phone alone: status, date and total, no items; phone + code: the items", async () => {
    const db = testDb();
    seedShop(db);
    const id = addOrder(db, { status: "confirmee", phone: "0554650718" });
    const code = (await db.prepare("SELECT public_code FROM orders WHERE id = ?").bind(id).first("public_code")) as string;
    const env = { DB: db, MEDIA_ORIGIN: "", PUBLIC_ORIGIN: "http://localhost" } as unknown as Env;
    const app = new Hono<AppEnv>();
    app.route("/", publicRoutes);
    const look = async (data: unknown) =>
      (await (await app.request("/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }, env)).json()) as {
        code: string; status: string; total: number; items: { nameFr: string }[];
      }[];

    const byPhone = await look({ phone: "0554650718" });
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0]).toMatchObject({ code, status: "confirmee" });
    expect(byPhone[0]!.items).toEqual([]);

    const withCode = await look({ phone: "0554650718", code });
    expect(withCode[0]!.items.map((i) => i.nameFr)).toEqual(["Pyjama"]);
  });
});
