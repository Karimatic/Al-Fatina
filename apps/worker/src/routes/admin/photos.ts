/**
 * Admin → Produits → photos: upload (validated, stored in R2), the "studio" cut-out, order
 * and deletion.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { imageRef, type ImageRow } from "../../lib/catalog";
import { randomToken } from "../../lib/crypto";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { actorOf, requirePermission } from "../../middleware/access";
import { optText, unusedImageKeys } from "./catalog-shared";

export const photoRoutes = new Hono<AppEnv>();

/* ───────────── Photos (R2) ─────────────
 * The admin browser resizes and encodes each photo (480/960/1440 px, WebP or JPEG) and strips
 * EXIF/GPS by re-drawing it on a canvas. The Worker only validates and stores the files.
 */

const MAX_FILE = 1_500_000;
const SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ["webp", (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
];

/**
 * "Studio" photo: the product cut out (background removed with Cloudflare Images, BiRefNet),
 * trimmed, centred in the same 4:5 frame with transparent space around it. Every product then
 * looks alike in the shop, on the theme's background. The admin uploads the result like any
 * photo; when the service is unavailable (monthly quota, error) it keeps the original photo.
 */
photoRoutes.post("/images/studio", requirePermission("products.edit"), async (c) => {
  if (!c.env.IMAGES) throw new HttpError(503, "studio_unavailable");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("image");
  if (!file || typeof file === "string") throw new HttpError(400, "image_required");
  if (file.size > 15_000_000) throw new HttpError(413, "file_too_large");
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isImage = (head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50) || String.fromCharCode(...head.slice(8, 12)) === "WEBP";
  if (!isImage) throw new HttpError(415, "image_type");
  try {
    const out = await c.env.IMAGES.input(file.stream())
      .transform({ segment: "foreground" })
      .transform({ trim: { border: { color: "transparent", tolerance: 10 } } })
      .transform({ width: 1104, height: 1380, fit: "contain" })
      .transform({ width: 1200, height: 1500, fit: "pad", background: "rgba(0,0,0,0)" })
      .output({ format: "image/webp", quality: 90 });
    return out.response({ headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.warn("studio photo:", err instanceof Error ? err.message : err);
    throw new HttpError(503, "studio_unavailable");
  }
});

photoRoutes.post("/products/:id/images", requirePermission("products.edit"), async (c) => {
  const productId = intParam(c, "id");
  const exists = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
  if (!exists) throw new HttpError(404, "not_found");
  const form = await c.req.formData();
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  const lqip = String(form.get("lqip") ?? "");
  const optionValueId = form.get("optionValueId") ? Number(form.get("optionValueId")) : null;
  if (!width || !height || width > 10000 || height > 10000) throw new HttpError(422, "invalid_dimensions");
  if (lqip && (!lqip.startsWith("data:image/") || lqip.length > 3000)) throw new HttpError(422, "invalid_lqip");

  const files: { w: number; data: Uint8Array; ext: string }[] = [];
  for (const w of [480, 960, 1440]) {
    const f = form.get(`w${w}`);
    if (!(f instanceof File)) continue;
    if (f.size > MAX_FILE) throw new HttpError(413, "file_too_large");
    const data = new Uint8Array(await f.arrayBuffer());
    const ext = SIGNATURES.find(([, test]) => test(data))?.[0];
    if (!ext) throw new HttpError(415, "unsupported_image"); // magic bytes, not the declared type
    files.push({ w, data, ext });
  }
  if (!files.length) throw new HttpError(422, "no_files");
  const ext = files[0]!.ext;
  if (files.some((f) => f.ext !== ext)) throw new HttpError(422, "mixed_formats");

  const baseKey = `p/${productId}/${randomToken(9)}-{w}.${ext}`;
  await Promise.all(
    files.map((f) =>
      c.env.MEDIA.put(baseKey.replace("{w}", String(f.w)), f.data, {
        httpMetadata: { contentType: ext === "webp" ? "image/webp" : "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
      }),
    ),
  );
  const sort = await c.env.DB.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM product_images WHERE product_id = ?").bind(productId).first<{ s: number }>();
  const row = await c.env.DB.prepare(
    "INSERT INTO product_images (product_id, option_value_id, base_key, widths, width, height, lqip, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
  )
    .bind(productId, optionValueId, baseKey, JSON.stringify(files.map((f) => f.w)), width, height, lqip || null, sort?.s ?? 0)
    .first<ImageRow>();
  await c.env.DB.batch([bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "upload", "product_image", row!.id, { productId })]);
  return c.json({ id: row!.id, ...imageRef(c.env, row!) }, 201);
});

photoRoutes.put("/products/:id/images", requirePermission("products.edit"), async (c) => {
  const productId = intParam(c, "id");
  const input = await body(
    c,
    z.array(z.object({ id: z.number().int().positive(), optionValueId: z.number().int().positive().nullable(), altFr: optText(160), altAr: optText(160) })).max(40),
  );
  await c.env.DB.batch([
    ...input.map((img, i) =>
      c.env.DB.prepare("UPDATE product_images SET sort = ?, option_value_id = ?, alt_fr = ?, alt_ar = ? WHERE id = ? AND product_id = ?").bind(
        i, img.optionValueId, img.altFr ?? null, img.altAr ?? null, img.id, productId,
      ),
    ),
    bumpCatalogStmt(c.env),
  ]);
  return c.json({ ok: true });
});

photoRoutes.delete("/images/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const img = await c.env.DB.prepare("SELECT base_key, widths FROM product_images WHERE id = ?").bind(id).first<{ base_key: string; widths: string }>();
  if (!img) throw new HttpError(404, "not_found");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM product_images WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "delete", "product_image", id),
  ]);
  const keys = await unusedImageKeys(c.env, [img]);
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys));
  return c.json({ ok: true });
});
