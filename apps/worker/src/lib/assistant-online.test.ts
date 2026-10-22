import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { testDb } from "../test/db";
import { answer } from "./assistant-intents";

const env = () => ({ DB: testDb(), ENVIRONMENT: "production", PUBLIC_ORIGIN: "https://shop.test" }) as unknown as Env;

describe("assistant: Al Fatina sells online only", () => {
  it("asked for a shop, its address or its hours: online only, no address, no map", async () => {
    for (const [q, locale] of [
      ["Où est votre magasin ?", "fr"],
      ["vous êtes ouvert à quelle heure ?", "fr"],
      ["وين راكم المحل تاعكم", "ar"],
    ] as const) {
      const r = await answer(env(), { q, locale });
      expect(r.intent).toBe("shop");
      expect(r.reply).toMatch(locale === "fr" ? /100 % en ligne/ : /متجر إلكتروني فقط/);
      expect(r.actions?.some((a) => a.href.includes("google.com/maps") || a.href === "/boutique")).toBe(false);
    }
  });
});
