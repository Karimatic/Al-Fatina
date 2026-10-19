/**
 * Admin → Produits: products (with option/variant matrix), duplicates, deletion and the
 * clearance sale on several products. Photos, categories and stock have their own files.
 */
import { Hono } from "hono";
import { z } from "zod";
import { hasPermission, salePrice, slugify } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { imageRef, mediaUrl, variantLabels, type ImageRow } from "../../lib/catalog";
import { body, HttpError, intParam } from "../../lib/http";
import { bumpCatalogStmt } from "../../lib/settings";
import { notifyRestocked } from "../../lib/telegram";
import { sendRestockPushes } from "../../lib/webpush";
import { actorOf, requirePermission } from "../../middleware/access";
import { translate } from "./translate";
import { canSeeCost, money, optText, text, unusedImageKeys } from "./catalog-shared";

export const catalogRoutes = new Hono<AppEnv>();


/* ───────────── Products ───────────── */

catalogRoutes.get("/products", requirePermission("products.view"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const category = c.req.query("category");
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push("(p.name_fr LIKE ? OR p.name_ar LIKE ? OR p.slug LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku LIKE ?))");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status && status !== "all") {
    where.push("p.status = ?");
    binds.push(status);
  } else where.push("p.status != 'archived'");
  if (category) {
    // a main category also lists its sub-categories' products
    where.push("(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))");
    binds.push(Number(category), Number(category));
  }
  const stock = c.req.query("stock");
  if (stock === "out") where.push("NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_on_hand - v.stock_reserved > 0)");
  // low: the product as a whole (what is left ≤ the alert levels of its sizes added up), not
  // one size of a product that still has plenty; a sold-out size has its own filter
  const left = "SELECT COALESCE(SUM(v.stock_on_hand - v.stock_reserved), 0) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1";
  const alertAt = "SELECT COALESCE(SUM(v.low_stock_threshold), 0) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1";
  if (stock === "low") where.push(`(${left}) > 0 AND (${left}) <= (${alertAt})`);
  if (stock === "size_out")
    where.push(`(${left}) > 0 AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_on_hand - v.stock_reserved <= 0)`);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.name_fr, p.name_ar, p.status, p.price, p.compare_at_price, p.updated_at, c.name_fr AS category, p.category_id, c.sort AS category_sort,
            (SELECT base_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_key,
            (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
            (SELECT COALESCE(SUM(v.stock_on_hand - v.stock_reserved), 0) FROM variants v WHERE v.product_id = p.id AND v.is_active = 1) AS available,
            (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = p.id AND o.status NOT IN ('annulee','doublon','fausse')) AS sold
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.updated_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all<Record<string, unknown> & { id: number; image_key: string | null }>();
  // which sizes / colours are sold out (shown on each product line)
  const ids = results.map((r) => r.id);
  const out = ids.length
    ? (
        await c.env.DB.prepare(
          `SELECT id, product_id FROM variants WHERE is_active = 1 AND stock_on_hand - stock_reserved <= 0 AND product_id IN (${ids.map(() => "?").join(",")})`,
        )
          .bind(...ids)
          .all<{ id: number; product_id: number }>()
      ).results
    : [];
  const outLabels = await variantLabels(c.env, out.map((v) => v.id));
  return c.json(
    results.map((r) => ({
      ...r,
      image: r.image_key ? mediaUrl(c.env, r.image_key).replace("{w}", "480") : null,
      sold_out: out.filter((v) => v.product_id === r.id).map((v) => outLabels.get(v.id)?.fr ?? "").filter(Boolean),
    })),
  );
});

async function loadProduct(c: { env: AppEnv["Bindings"]; get: (k: "member") => { permissions: string[] } }, id: number) {
  const p = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!p) throw new HttpError(404, "not_found");
  const [options, values, variants, images] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM product_options WHERE product_id = ? ORDER BY sort, id").bind(id),
    c.env.DB.prepare("SELECT v.* FROM option_values v JOIN product_options o ON o.id = v.option_id WHERE o.product_id = ? ORDER BY v.sort, v.id").bind(id),
    c.env.DB.prepare("SELECT * FROM variants WHERE product_id = ? ORDER BY id").bind(id),
    c.env.DB.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id").bind(id),
  ]);
  const vals = values!.results as { id: number; option_id: number; label_fr: string; label_ar: string; hex: string | null; sort: number }[];
  return {
    id: p.id,
    slug: p.slug,
    nameFr: p.name_fr,
    nameAr: p.name_ar,
    descriptionFr: p.description_fr ?? "",
    descriptionAr: p.description_ar ?? "",
    status: p.status,
    categoryId: p.category_id,
    tags: JSON.parse((p.tags as string) || "[]"),
    price: p.price,
    compareAtPrice: p.compare_at_price,
    // the purchase price is private: only for those allowed to see costs
    costPrice: canSeeCost(c) ? p.cost_price : null,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    instagramUrl: p.instagram_url,
    relatedIds: JSON.parse((p.related_ids as string) || "[]") as number[],
    sizeGuideId: (p.size_guide_id as number | null) ?? null,
    publishedAt: p.published_at as number | null,
    options: (options!.results as { id: number; kind: string; name_fr: string; name_ar: string }[]).map((o) => ({
      id: o.id,
      kind: o.kind,
      nameFr: o.name_fr,
      nameAr: o.name_ar,
      values: vals.filter((v) => v.option_id === o.id).map((v) => ({ ref: `v:${v.id}`, id: v.id, labelFr: v.label_fr, labelAr: v.label_ar, hex: v.hex })),
    })),
    variants: (
      variants!.results as {
        id: number; sku: string; barcode: string | null; option_value_ids: string; price_override: number | null;
        stock_on_hand: number; stock_reserved: number; low_stock_threshold: number; is_active: number;
      }[]
    ).map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      refs: (JSON.parse(v.option_value_ids) as number[]).map((x) => `v:${x}`),
      priceOverride: v.price_override,
      stockOnHand: v.stock_on_hand,
      stockReserved: v.stock_reserved,
      lowStockThreshold: v.low_stock_threshold,
      isActive: !!v.is_active,
    })),
    images: (images!.results as unknown as ImageRow[]).map((r) => ({ id: r.id, ...imageRef(c.env, r) })),
    video: p.video_key ? mediaUrl(c.env, p.video_key as string) : null,
  };
}

catalogRoutes.get("/products/:id", requirePermission("products.view"), async (c) => c.json(await loadProduct(c, intParam(c, "id"))));

const productInput = z.object({
  nameFr: text(120).min(2),
  nameAr: text(120),
  slug: text(90).optional(),
  descriptionFr: text(5000).default(""),
  descriptionAr: text(5000).default(""),
  status: z.enum(["draft", "published", "archived"]),
  categoryId: z.number().int().positive().nullable(),
  tags: z.array(text(30)).max(10).default([]),
  price: money,
  compareAtPrice: money.nullable().optional(),
  costPrice: money.nullable().optional(),
  seoTitle: optText(120),
  seoDescription: optText(300),
  instagramUrl: optText(300),
  /** hand-picked "Complétez le look" products */
  relatedIds: z.array(z.number().int().positive()).max(12).default([]),
  /** size chart shown on the product page */
  sizeGuideId: z.number().int().positive().nullable().default(null),
  options: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        kind: z.enum(["taille", "couleur", "autre"]),
        nameFr: text(40).min(1),
        nameAr: text(40),
        values: z
          .array(
            z.object({
              ref: text(40).min(1),
              labelFr: text(40).min(1),
              labelAr: text(40),
              hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .max(3),
  variants: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        refs: z.array(text(40)).max(3),
        sku: text(60).optional(),
        barcode: optText(60),
        priceOverride: money.nullable().optional(),
        stockOnHand: z.number().int().min(0).max(100_000),
        lowStockThreshold: z.number().int().min(0).max(1000).default(2),
        isActive: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(200),
});
type ProductInput = z.infer<typeof productInput>;

async function nextIds(env: AppEnv["Bindings"]) {
  const r = await env.DB.prepare(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM products) AS p, (SELECT COALESCE(MAX(id), 0) FROM product_options) AS o,
            (SELECT COALESCE(MAX(id), 0) FROM option_values) AS v, (SELECT COALESCE(MAX(id), 0) FROM variants) AS var`,
  ).first<{ p: number; o: number; v: number; var: number }>();
  return { product: r!.p + 1, option: r!.o + 1, value: r!.v + 1, variant: r!.var + 1 };
}

/**
 * Colour names typed in one language only ("Champagne") get their Arabic twin ("شمباني").
 * Sizes (S, M, 38…) stay as they are; nothing changes when the AI is unavailable.
 */
async function translateOptionLabels(env: AppEnv["Bindings"], input: ProductInput): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const o of input.options) {
    if (o.kind === "taille") continue;
    for (const v of o.values) {
      if ((v.labelAr && v.labelAr !== v.labelFr) || !/\p{Script=Latin}{3,}/u.test(v.labelFr)) continue;
      jobs.push(
        translate(env, v.labelFr, "ar")
          .then((ar) => void (v.labelAr = ar.slice(0, 40)))
          .catch(() => undefined),
      );
    }
  }
  await Promise.all(jobs);
}


async function saveProduct(c: Parameters<typeof body>[0], existingId: number | null, input: ProductInput) {
  const env = c.env;
  const actor = actorOf(c.get("member"));
  await translateOptionLabels(env, input);
  const now = Date.now();
  const ids = await nextIds(env);
  const productId = existingId ?? ids.product;
  const base = slugify(input.slug || input.nameFr) || `produit-${productId}`;
  const taken = async (s: string) => !!(await env.DB.prepare("SELECT id FROM products WHERE slug = ? AND id != ?").bind(s, productId).first());
  let slug = base;
  if (await taken(slug)) {
    // an address typed by hand stays as typed: say it is taken
    if (input.slug) throw new HttpError(409, "slug_taken");
    // made from the name (two pieces called « Pyjama satin », an old draft…): the next free number
    let n = 2;
    while (await taken((slug = `${base}-${n}`))) if (++n > 50) throw new HttpError(409, "slug_taken");
  }

  const current = existingId ? await loadProduct(c, existingId) : null;
  const canStock = hasPermission(c.get("member").permissions, "stock.edit");
  // without the cost permission the purchase price is neither shown nor changed: keep the stored one
  if (!canSeeCost(c)) {
    const kept = existingId ? await env.DB.prepare("SELECT cost_price FROM products WHERE id = ?").bind(existingId).first<{ cost_price: number | null }>() : null;
    input = { ...input, costPrice: kept?.cost_price ?? null };
  }
  const stmts: D1PreparedStatement[] = [];

  if (existingId) {
    stmts.push(
      env.DB.prepare(
        `UPDATE products SET slug = ?, name_fr = ?, name_ar = ?, description_fr = ?, description_ar = ?, status = ?, category_id = ?, tags = ?,
           price = ?, compare_at_price = ?, cost_price = ?, seo_title = ?, seo_description = ?, instagram_url = ?, related_ids = ?, size_guide_id = ?,
           published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN ? END), updated_at = ? WHERE id = ?`,
      ).bind(
        slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr, input.descriptionAr, input.status, input.categoryId,
        JSON.stringify(input.tags), input.price, input.compareAtPrice ?? null, input.costPrice ?? null, input.seoTitle ?? null,
        input.seoDescription ?? null, input.instagramUrl ?? null, JSON.stringify(input.relatedIds.filter((x) => x !== productId)), input.sizeGuideId,
        input.status, now, now, productId,
      ),
    );
  } else {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO products (id, slug, name_fr, name_ar, description_fr, description_ar, status, category_id, tags, price, compare_at_price,
           cost_price, seo_title, seo_description, instagram_url, related_ids, size_guide_id, published_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        productId, slug, input.nameFr, input.nameAr || input.nameFr, input.descriptionFr, input.descriptionAr, input.status, input.categoryId,
        JSON.stringify(input.tags), input.price, input.compareAtPrice ?? null, input.costPrice ?? null, input.seoTitle ?? null,
        input.seoDescription ?? null, input.instagramUrl ?? null, JSON.stringify(input.relatedIds), input.sizeGuideId, input.status === "published" ? now : null,
        c.get("member").id, now, now,
      ),
    );
  }

  // ── options & values: upsert with explicit ids, delete what disappeared
  const refToId = new Map<string, number>();
  const keptOptionIds = new Set<number>();
  const keptValueIds = new Set<number>();
  const existingOptionIds = new Set(current?.options.map((o) => o.id) ?? []);
  const existingValueIds = new Set(current?.options.flatMap((o) => o.values.map((v) => v.id)) ?? []);
  let nextOption = ids.option;
  let nextValue = ids.value;
  input.options.forEach((o, oi) => {
    const optionId = o.id && existingOptionIds.has(o.id) ? o.id : nextOption++;
    keptOptionIds.add(optionId);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO product_options (id, product_id, kind, name_fr, name_ar, sort) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name_fr = excluded.name_fr, name_ar = excluded.name_ar, sort = excluded.sort`,
      ).bind(optionId, productId, o.kind, o.nameFr, o.nameAr || o.nameFr, oi),
    );
    o.values.forEach((v, vi) => {
      const m = /^v:(\d+)$/.exec(v.ref);
      const existing = m && existingValueIds.has(Number(m[1])) ? Number(m[1]) : null;
      const valueId = existing ?? nextValue++;
      refToId.set(v.ref, valueId);
      keptValueIds.add(valueId);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO option_values (id, option_id, label_fr, label_ar, hex, sort) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET option_id = excluded.option_id, label_fr = excluded.label_fr, label_ar = excluded.label_ar, hex = excluded.hex, sort = excluded.sort`,
        ).bind(valueId, optionId, v.labelFr, v.labelAr || v.labelFr, v.hex ?? null, vi),
      );
    });
  });
  for (const id of existingValueIds) {
    if (!keptValueIds.has(id)) {
      stmts.push(env.DB.prepare("UPDATE product_images SET option_value_id = NULL WHERE option_value_id = ?").bind(id));
      stmts.push(env.DB.prepare("DELETE FROM option_values WHERE id = ?").bind(id));
    }
  }
  for (const id of existingOptionIds) if (!keptOptionIds.has(id)) stmts.push(env.DB.prepare("DELETE FROM product_options WHERE id = ?").bind(id));

  // ── variants
  const currentVariants = new Map(current?.variants.map((v) => [v.id, v]) ?? []);
  const restocked: number[] = [];
  const keptVariantIds = new Set<number>();
  let nextVariant = ids.variant;
  const labelPrefix = slug.split("-").slice(0, 2).join("-").toUpperCase().slice(0, 12) || `P${productId}`;
  const seenSku = new Set<string>();
  for (const v of input.variants) {
    const valueIds = v.refs.map((r) => {
      const id = refToId.get(r);
      if (!id) throw new HttpError(422, "variant_unknown_value", { ref: r });
      return id;
    });
    const isExisting = v.id != null && currentVariants.has(v.id);
    const variantId = isExisting ? v.id! : nextVariant++;
    keptVariantIds.add(variantId);
    // quantities belong to the Stock permission: without it, the product page keeps them as they
    // are (a new size starts at 0, to be counted in Stock)
    if (!canStock) v.stockOnHand = isExisting ? currentVariants.get(v.id!)!.stockOnHand : 0;
    const valueLabels = v.refs.map((r) => input.options.flatMap((o) => o.values).find((x) => x.ref === r)?.labelFr ?? "");
    let sku = (v.sku || `${labelPrefix}-${valueLabels.map((l) => slugify(l).toUpperCase()).join("-")}` || `${labelPrefix}-${variantId}`).toUpperCase();
    if (seenSku.has(sku)) sku = `${sku}-${variantId}`;
    seenSku.add(sku);
    if (isExisting) {
      const before = currentVariants.get(v.id!)!;
      stmts.push(
        env.DB.prepare(
          `UPDATE variants SET sku = ?, barcode = ?, option_value_ids = ?, price_override = ?, stock_on_hand = ?, low_stock_threshold = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        ).bind(sku, v.barcode ?? null, JSON.stringify(valueIds), v.priceOverride ?? null, v.stockOnHand, v.lowStockThreshold, v.isActive ? 1 : 0, now, variantId),
      );
      if (before.stockOnHand - before.stockReserved <= 0 && v.stockOnHand - before.stockReserved > 0) restocked.push(variantId);
      if (before.stockOnHand !== v.stockOnHand) {
        stmts.push(
          env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, 'ajustement', 'Fiche produit', ?, ?)").bind(
            variantId, v.stockOnHand - before.stockOnHand, actor, now,
          ),
        );
      }
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO variants (id, product_id, sku, barcode, option_value_ids, price_override, stock_on_hand, stock_reserved, low_stock_threshold, is_active, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).bind(variantId, productId, sku, v.barcode ?? null, JSON.stringify(valueIds), v.priceOverride ?? null, v.stockOnHand, v.lowStockThreshold, v.isActive ? 1 : 0, now),
      );
      if (v.stockOnHand > 0) {
        stmts.push(
          env.DB.prepare("INSERT INTO stock_movements (variant_id, delta, reason, note, actor, created_at) VALUES (?, ?, 'reception', 'Création', ?, ?)").bind(
            variantId, v.stockOnHand, actor, now,
          ),
        );
      }
    }
  }
  // removed variants: delete if never ordered, otherwise deactivate (order history keeps its link)
  const removed = [...currentVariants.keys()].filter((id) => !keptVariantIds.has(id));
  if (removed.length) {
    const ph = removed.map(() => "?").join(",");
    const { results: used } = await env.DB.prepare(`SELECT DISTINCT variant_id FROM order_items WHERE variant_id IN (${ph})`).bind(...removed).all<{ variant_id: number }>();
    const usedSet = new Set(used.map((u) => u.variant_id));
    for (const id of removed) {
      if (usedSet.has(id)) stmts.push(env.DB.prepare("UPDATE variants SET is_active = 0, updated_at = ? WHERE id = ?").bind(now, id));
      else {
        stmts.push(env.DB.prepare("DELETE FROM stock_movements WHERE variant_id = ?").bind(id));
        stmts.push(env.DB.prepare("DELETE FROM stock_alerts WHERE variant_id = ?").bind(id));
        stmts.push(env.DB.prepare("DELETE FROM variants WHERE id = ?").bind(id));
      }
    }
  }

  stmts.push(bumpCatalogStmt(env), auditStmt(env, actor, existingId ? "update" : "create", "product", productId, { name: input.nameFr, status: input.status }));

  try {
    await env.DB.batch(stmts);
  } catch (err) {
    const msg = String((err as Error).message);
    if (msg.includes("variants_stock_ok")) throw new HttpError(409, "stock_below_reserved");
    if (msg.includes("variants.sku")) throw new HttpError(409, "sku_taken");
    if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY")) throw new HttpError(409, "conflict_retry");
    throw err;
  }
  if (restocked.length) {
    c.executionCtx.waitUntil(notifyRestocked(env, restocked).catch(() => undefined));
    c.executionCtx.waitUntil(sendRestockPushes(env, restocked).catch(() => undefined));
  }
  return productId;
}

catalogRoutes.post("/products", requirePermission("products.edit"), async (c) => {
  const id = await saveProduct(c, null, await body(c, productInput));
  return c.json(await loadProduct(c, id), 201);
});

catalogRoutes.put("/products/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  await saveProduct(c, id, await body(c, productInput));
  return c.json(await loadProduct(c, id));
});

catalogRoutes.post("/products/:id/duplicate", requirePermission("products.edit"), async (c) => {
  const src = await loadProduct(c, intParam(c, "id"));
  const copy: ProductInput = {
    nameFr: `${src.nameFr} (copie)`,
    nameAr: String(src.nameAr),
    slug: `${src.slug}-copie-${Date.now().toString(36).slice(-4)}`,
    descriptionFr: String(src.descriptionFr),
    descriptionAr: String(src.descriptionAr),
    status: "draft",
    categoryId: (src.categoryId as number | null) ?? null,
    tags: src.tags as string[],
    price: src.price as number,
    compareAtPrice: src.compareAtPrice as number | null,
    costPrice: src.costPrice as number | null,
    seoTitle: null,
    seoDescription: null,
    instagramUrl: null,
    relatedIds: src.relatedIds,
    sizeGuideId: src.sizeGuideId,
    options: src.options.map((o) => ({ kind: o.kind as "taille" | "couleur" | "autre", nameFr: o.nameFr, nameAr: o.nameAr, values: o.values.map((v) => ({ ref: `n:${v.id}`, labelFr: v.labelFr, labelAr: v.labelAr, hex: v.hex })) })),
    variants: src.variants.map((v) => ({ refs: v.refs.map((r) => r.replace("v:", "n:")), priceOverride: v.priceOverride, stockOnHand: 0, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive })),
  };
  const id = await saveProduct(c, null, copy);

  // photos are shared with the original (same files in R2, never deleted while still used);
  // colour-specific photos follow the copied colour (options and values keep their order)
  if (src.images.length) {
    const dst = await loadProduct(c, id);
    const valueMap = new Map<number, number>();
    src.options.forEach((o, oi) => o.values.forEach((v, vi) => {
      const target = dst.options[oi]?.values[vi];
      if (target) valueMap.set(v.id, target.id);
    }));
    const { results: rows } = await c.env.DB.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id").bind(src.id).all<ImageRow>();
    await c.env.DB.batch([
      ...rows.map((r) =>
        c.env.DB.prepare(
          "INSERT INTO product_images (product_id, option_value_id, base_key, widths, width, height, lqip, alt_fr, alt_ar, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, r.option_value_id != null ? (valueMap.get(r.option_value_id) ?? null) : null, r.base_key, r.widths, r.width, r.height, r.lqip, r.alt_fr, r.alt_ar, r.sort),
      ),
      bumpCatalogStmt(c.env),
    ]);
  }
  return c.json({ id }, 201);
});


catalogRoutes.delete("/products/:id", requirePermission("products.edit"), async (c) => {
  const id = intParam(c, "id");
  const actor = actorOf(c.get("member"));
  // sold once (by the product or one of its sizes): archived, so the orders keep their history
  const ordered = await c.env.DB.prepare(
    "SELECT 1 FROM order_items WHERE product_id = ?1 OR variant_id IN (SELECT id FROM variants WHERE product_id = ?1) LIMIT 1",
  )
    .bind(id)
    .first();
  if (ordered) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?").bind(Date.now(), id),
      bumpCatalogStmt(c.env),
      auditStmt(c.env, actor, "archive", "product", id),
    ]);
    return c.json({ archived: true });
  }
  const { results: imgs } = await c.env.DB.prepare("SELECT base_key, widths FROM product_images WHERE product_id = ?").bind(id).all<{ base_key: string; widths: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM stock_movements WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM stock_alerts WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)").bind(id),
    // its lines in stock counts (Inventaire) and exchange requests pointed to its sizes: the
    // delete failed (« FOREIGN KEY constraint failed »)
    c.env.DB.prepare("DELETE FROM stock_count_lines WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM exchange_requests WHERE to_variant_id IN (SELECT id FROM variants WHERE product_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actor, "delete", "product", id),
  ]);
  const keys = await unusedImageKeys(c.env, imgs);
  if (keys.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(keys));
  return c.json({ deleted: true });
});


/* ───────────── Clearance sale: several products at once ───────────── */

/**
 * "Mettre en promo −X %": the usual price becomes the crossed-out price and the sale price
 * applies (rounded to 50 DA). "Retirer la promo" puts the usual price back.
 */
catalogRoutes.post("/products/sale", requirePermission("products.edit"), async (c) => {
  const input = await body(
    c,
    z.union([
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), percent: z.number().int().min(1).max(90) }),
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), restore: z.literal(true) }),
    ]),
  );
  const ph = input.ids.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(`SELECT id, price, compare_at_price FROM products WHERE id IN (${ph})`)
    .bind(...input.ids)
    .all<{ id: number; price: number; compare_at_price: number | null }>();
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const p of results) {
    if ("percent" in input) {
      const usual = p.compare_at_price && p.compare_at_price > p.price ? p.compare_at_price : p.price;
      stmts.push(c.env.DB.prepare("UPDATE products SET compare_at_price = ?, price = ?, updated_at = ? WHERE id = ?").bind(usual, salePrice(usual, input.percent), now, p.id));
    } else if (p.compare_at_price && p.compare_at_price > p.price) {
      stmts.push(c.env.DB.prepare("UPDATE products SET price = compare_at_price, compare_at_price = NULL, updated_at = ? WHERE id = ?").bind(now, p.id));
    }
  }
  if (!stmts.length) return c.json({ ok: true, changed: 0 });
  await c.env.DB.batch([
    ...stmts,
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "percent" in input ? "sale" : "sale_end", "product", input.ids.join(","), "percent" in input ? { percent: input.percent } : undefined),
  ]);
  return c.json({ ok: true, changed: stmts.length });
});
