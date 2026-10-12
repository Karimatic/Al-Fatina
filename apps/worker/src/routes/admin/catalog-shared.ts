/**
 * Shared by the catalogue routes (products, photos, categories, stock): field rules, who
 * sees purchase prices, and which photo files are no longer used.
 */
import { z } from "zod";
import { hasPermission } from "@henine/shared";
import type { AppEnv } from "../../env";

export const text = (max: number) => z.string().trim().max(max);
export const optText = (max: number) => z.string().trim().max(max).nullable().optional();
export const money = z.number().int().min(0).max(10_000_000);

/** The purchase price (and so the margin) is shown and changed only with the cost permission. */
export function canSeeCost(c: { get: (k: "member") => { permissions: string[] } }): boolean {
  return hasPermission(c.get("member").permissions, "cost.view");
}

/** R2 files of these images that no other product still uses (photos can be shared by duplicates). */
export async function unusedImageKeys(env: AppEnv["Bindings"], imgs: { base_key: string; widths: string }[]): Promise<string[]> {
  if (!imgs.length) return [];
  const { results } = await env.DB.prepare(`SELECT DISTINCT base_key FROM product_images WHERE base_key IN (${imgs.map(() => "?").join(",")})`)
    .bind(...imgs.map((i) => i.base_key))
    .all<{ base_key: string }>();
  const stillUsed = new Set(results.map((r) => r.base_key));
  return imgs.filter((i) => !stillUsed.has(i.base_key)).flatMap((i) => (JSON.parse(i.widths) as number[]).map((w) => i.base_key.replace("{w}", String(w))));
}
