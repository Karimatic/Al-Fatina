/**
 * Admin → Page d'accueil: sections, texts, checkout options, and the store's look (logo,
 * colours, fonts, banners).
 */
import { Hono } from "hono";
import { z } from "zod";
import { ANNOUNCEMENT_ANIMATIONS, cleanText, DEFAULT_DESIGN, FONT_FAMILIES, FONT_PRESETS, HOME_SECTIONS, isHexColor, isSafeLink, OWN_FONT, type DesignDTO, type FontPreset } from "@elfatina/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { mediaUrl } from "../../lib/catalog";
import { body, HttpError } from "../../lib/http";
import { putFont, putImage, putVideo } from "../../lib/media";
import { bumpCatalogStmt, getSetting, getSettings, setSettingStmt } from "../../lib/settings";
import { translate } from "./translate";
import { actorOf, requirePermission } from "../../middleware/access";

export const homepageRoutes = new Hono<AppEnv>();

/* ───────────── Page d'accueil + checkout options ───────────── */

homepageRoutes.get("/home", requirePermission("marketing.edit"), async (c) => {
  return c.json(await getSettings(c.env, ["announcement", "checkout", "contact", "maintenance", "store", "texts"]));
});

/**
 * Home page switches. The texts themselves (hero, announcement messages, FAQ, pause message)
 * are built into the store and shown in the visitor's language, so only on/off switches and
 * checkout options are saved here.
 */
homepageRoutes.put("/home", requirePermission("marketing.edit"), async (c) => {
  const input = await body(
    c,
    z.object({
      announcement: z.object({ active: z.boolean().optional(), animation: z.enum(ANNOUNCEMENT_ANIMATIONS).optional() }),
      checkout: z
        .object({
          express_on_product: z.boolean(), desk_enabled: z.boolean(), free_shipping_over: z.number().int().min(0).nullable(),
          max_orders_per_phone_per_hour: z.number().int().min(1).max(20),
        })
        .optional(),
      maintenance: z.object({ active: z.boolean() }).optional(),
    }),
  );
  const current = await getSettings(c.env, ["checkout", "announcement", "maintenance"]);
  await c.env.DB.batch([
    setSettingStmt(c.env, "announcement", { ...current.announcement, ...input.announcement }),
    setSettingStmt(c.env, "checkout", { ...current.checkout, ...input.checkout }),
    setSettingStmt(c.env, "maintenance", { ...current.maintenance, ...input.maintenance }),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "home"),
  ]);
  return c.json({ ok: true });
});

/**
 * Store texts, one language at a time: only what the team changed is stored, everything
 * else keeps the built-in text of that language (STORE_TEXTS in @elfatina/shared).
 */
const textsInput = z
  .object({
    eyebrow: cleanText(60),
    title: cleanText(90),
    subtitle: cleanText(240),
    announcement: z.array(cleanText(120)).max(8),
    faq: z.array(z.object({ q: cleanText(200), a: cleanText(1000) })).max(20),
    pause: cleanText(240),
  })
  .partial();

type TextOverrides = z.infer<typeof textsInput>;

/**
 * The texts changed in one language, translated into the other (French ↔ Arabic); a text put
 * back to its original wording goes back to the original in the other language too. A text that
 * can't be translated right now (no AI quota) leaves the other language as it was.
 */
async function mirrorTexts(env: AppEnv["Bindings"], before: TextOverrides, after: TextOverrides, other: TextOverrides, to: "fr" | "ar"): Promise<TextOverrides> {
  const out: TextOverrides = { ...other };
  const tr = (t: string) => translate(env, t, to);
  const jobs: Promise<void>[] = [];
  for (const k of ["eyebrow", "title", "subtitle", "pause"] as const) {
    if (after[k] === before[k]) continue;
    if (after[k] == null) delete out[k];
    else jobs.push(tr(after[k]!).then((v) => void (out[k] = v.slice(0, k === "eyebrow" ? 60 : k === "title" ? 90 : 240))));
  }
  if (JSON.stringify(after.announcement) !== JSON.stringify(before.announcement)) {
    if (!after.announcement) delete out.announcement;
    else jobs.push(Promise.all(after.announcement.map(tr)).then((list) => void (out.announcement = list.map((m) => m.slice(0, 120)))));
  }
  if (JSON.stringify(after.faq) !== JSON.stringify(before.faq)) {
    if (!after.faq) delete out.faq;
    else
      jobs.push(
        Promise.all(after.faq.map(async (f) => ({ q: (await tr(f.q)).slice(0, 200), a: (await tr(f.a)).slice(0, 1000) }))).then((faq) => void (out.faq = faq)),
      );
  }
  await Promise.allSettled(jobs);
  return out;
}

homepageRoutes.put("/home/texts", requirePermission("marketing.edit"), async (c) => {
  const input = await body(c, z.object({ locale: z.enum(["ar", "fr"]), texts: textsInput }));
  const { texts } = await getSettings(c.env, ["texts"]);
  const otherLocale = input.locale === "fr" ? "ar" : "fr";
  const before = (texts[input.locale] ?? {}) as TextOverrides;
  const mirrored = await mirrorTexts(c.env, before, input.texts, (texts[otherLocale] ?? {}) as TextOverrides, otherLocale);
  const next = { ...texts, [input.locale]: input.texts, [otherLocale]: mirrored };
  await c.env.DB.batch([
    setSettingStmt(c.env, "texts", next),
    bumpCatalogStmt(c.env),
    auditStmt(c.env, actorOf(c.get("member")), "update", "settings", `texts.${input.locale}`, Object.keys(input.texts)),
  ]);
  return c.json(next);
});

/* ───────────── Apparence: logo, colours, fonts, banners, home sections ───────────── */

const mediaKey = z.string().trim().max(200).regex(/^design\/[a-z0-9_-]+\.(webp|jpg)$/i);
const videoKey = z.string().trim().max(200).regex(/^design\/[a-z0-9_-]+\.(mp4|webm)$/i);
const fontKey = z.string().trim().max(200).regex(/^design\/[a-z0-9_-]+\.(woff2|woff|ttf|otf)$/i);
const fontName = z.enum([OWN_FONT, ...FONT_FAMILIES.map((f): string => f.name)] as [string, ...string[]]);
const designInput = z.object({
  logo: mediaKey.nullable(),
  colors: z.object({ accent: z.string().refine(isHexColor, "color"), soft: z.string().refine(isHexColor, "color") }),
  font: z.enum(Object.keys(FONT_PRESETS) as [FontPreset, ...FontPreset[]]),
  customFont: z.object({ display: fontName, sans: fontName, arabic: fontName, arabicDisplay: fontName }).default(DEFAULT_DESIGN.customFont),
  fontFile: fontKey.nullable().default(null),
  fontFileName: cleanText(80).nullable().default(null),
  heroImage: mediaKey.nullable(),
  // a preset's key, "theme", or a colour of its own
  productBg: z.string().trim().max(20).refine((v) => !v.startsWith("#") || isHexColor(v), "color").default("theme"),
  heroVideo: videoKey.nullable().default(null),
  banners: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        // a picture, a video, or both (the picture shows while the video loads)
        image: mediaKey.or(z.literal("")),
        video: videoKey.nullable().optional(),
        titleFr: cleanText(80).default(""),
        titleAr: cleanText(80).default(""),
        subtitleFr: cleanText(140).default(""),
        subtitleAr: cleanText(140).default(""),
        link: z.string().trim().max(300).refine((l) => l === "" || isSafeLink(l), "link"),
      }).refine((b) => !!b.image || !!b.video, "banner_media"),
    )
    .max(6),
  featured: z.object({ titleFr: cleanText(60), titleAr: cleanText(60), productIds: z.array(z.number().int().positive()).max(24) }),
  footerFr: cleanText(300).default(""),
  footerAr: cleanText(300).default(""),
  sections: z.array(z.object({ key: z.enum(HOME_SECTIONS), on: z.boolean() })).max(HOME_SECTIONS.length),
});

homepageRoutes.get("/design", requirePermission("marketing.edit"), async (c) => {
  const design = await getSetting(c.env, "design");
  return c.json({ design: { ...DEFAULT_DESIGN, ...design }, mediaBase: mediaUrl(c.env, "") });
});

homepageRoutes.put("/design", requirePermission("marketing.edit"), async (c) => {
  const input = (await body(c, designInput)) as DesignDTO;
  const before = (await getSetting(c.env, "design")) as Partial<DesignDTO>;
  await c.env.DB.batch([setSettingStmt(c.env, "design", input), bumpCatalogStmt(c.env), auditStmt(c.env, actorOf(c.get("member")), "update", "settings", "design")]);
  // videos no longer used (replaced or removed) are deleted from storage: they are heavy
  // (and the shop's font file, once replaced or removed)
  const videos = (d: Partial<DesignDTO>) => [d.heroVideo, d.fontFile, ...(d.banners ?? []).map((b) => b.video)].filter((k): k is string => !!k && /^design\//.test(k));
  const kept = new Set(videos(input));
  const gone = videos(before).filter((k) => !kept.has(k));
  if (gone.length) c.executionCtx.waitUntil(c.env.MEDIA.delete(gone).catch(() => undefined));
  return c.json(input);
});

/** The big home page video (MP4 / WebM, ≤ 40 MB): stored now, used once the design is saved. */
homepageRoutes.post("/design/video", requirePermission("marketing.edit"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("video");
  if (!file || typeof file === "string") throw new HttpError(400, "video_required");
  const key = await putVideo(c.env, "design/video", file);
  return c.json({ key, url: mediaUrl(c.env, key) }, 201);
});

/** The shop's own font (WOFF2 / WOFF / TTF / OTF, ≤ 2 MB): stored now, used once the design is saved. */
homepageRoutes.post("/design/font", requirePermission("marketing.edit"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("font");
  if (!file || typeof file === "string") throw new HttpError(400, "font_required");
  const key = await putFont(c.env, "design/font", file);
  return c.json({ key, url: mediaUrl(c.env, key), name: file.name.slice(0, 80) }, 201);
});

/** Logo / hero / banner picture (WebP or JPEG made in the browser). */
homepageRoutes.post("/design/image", requirePermission("marketing.edit"), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("image");
  if (!file || typeof file === "string") throw new HttpError(400, "image_required");
  const key = await putImage(c.env, "design/img", file, 3_000_000);
  return c.json({ key, url: mediaUrl(c.env, key) }, 201);
});
