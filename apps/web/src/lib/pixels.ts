/**
 * Meta (Facebook / Instagram) and TikTok pixels: which ads bring visits and orders.
 *
 * Nothing is loaded or sent until the visitor agrees (the small consent card, law 18-07: the
 * data goes to companies outside Algeria). The ids come from Admin → Paramètres → Connexions
 * through /api/site. Their scripts load after the page is up, so the store's speed is the same.
 *
 * Events: PageView (every page), ViewContent (a product page), AddToCart, InitiateCheckout
 * (the order form) and Purchase (the thank-you page, once per order, the order's code as id so
 * Meta and TikTok never count it twice).
 */

import { hidePrivateToken } from "./privateToken";

type Ids = { meta: string | null; tiktok: string | null };
type Fn = ((...args: unknown[]) => void) & Record<string, unknown>;
type W = Window & { fbq?: Fn; _fbq?: Fn; ttq?: unknown[] & Record<string, unknown>; TiktokAnalyticsObject?: string };

const CONSENT_KEY = "elfatina.adsConsent";
export const CONSENT_EVENT = "elfatina:ads-consent";
/** « Publicités » in the footer: shows the choice again */
export const CONSENT_OPEN_EVENT = "elfatina:ads-consent-open";
export const openConsent = () => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
let ids: Ids | null = null;
let loaded = false;

export type Consent = "yes" | "no" | null;

export function consent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "yes" || v === "no" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(v: "yes" | "no") {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    /* private mode: asked again next visit */
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
  if (v === "yes") load();
  // said no after yes: the scripts already on this page stay until she leaves it, nothing is sent after
}

/** Pixels the shop set up (from /api/site). Starts them if she already agreed. */
export function initPixels(next: Ids) {
  ids = next;
  if (consent() === "yes") load();
}

export const pixelsConfigured = (p: Ids | null | undefined) => !!(p?.meta || p?.tiktok);

/** events of this page sent before the pixel ids arrived from /api/site: sent once they load */
let waiting: (() => void)[] = [];

function load() {
  if (loaded || !ids || !pixelsConfigured(ids)) return;
  loaded = true;
  // never with the private order token in the address (pixels send the page address)
  hidePrivateToken();
  // the queues exist at once (events of this page are kept), the scripts come after the page
  if (ids.meta) loadMeta(ids.meta);
  if (ids.tiktok) loadTiktok(ids.tiktok);
  for (const send of waiting) send();
  waiting = [];
}

/** Their script, downloaded once the page itself is drawn: the store's own paint first. */
function script(src: string) {
  const add = () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  };
  if (document.readyState === "complete") setTimeout(add, 0);
  else addEventListener("load", () => setTimeout(add, 0), { once: true });
}

/** Meta's standard loader (fbevents.js), written out so no inline script is needed. */
function loadMeta(id: string) {
  const w = window as W;
  if (!w.fbq) {
    const q: unknown[] = [];
    const fbq = function (this: unknown, ...args: unknown[]) {
      if (typeof fbq.callMethod === "function") (fbq.callMethod as (...a: unknown[]) => void)(...args);
      else q.push(args);
    } as Fn;
    Object.assign(fbq, { push: fbq, loaded: true, version: "2.0", queue: q });
    w.fbq = fbq;
    w._fbq ??= fbq;
    script("https://connect.facebook.net/en_US/fbevents.js");
  }
  // no « automatic advanced matching »: Meta must not read the order form (name, phone) (audit R5-7)
  w.fbq!("set", "autoConfig", false, id);
  w.fbq!("init", id);
  w.fbq!("track", "PageView");
}

/** TikTok's standard loader (events.js), written out so no inline script is needed. */
function loadTiktok(id: string) {
  const w = window as W;
  w.TiktokAnalyticsObject = "ttq";
  const ttq = (w.ttq ??= [] as unknown as NonNullable<W["ttq"]>);
  const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
  const defer = (target: Record<string, unknown> & unknown[], m: string) => {
    target[m] = (...args: unknown[]) => target.push([m, ...args]);
  };
  for (const m of methods) defer(ttq, m);
  const inst = ((ttq._i as Record<string, unknown>) ??= {}) as Record<string, unknown[] & Record<string, unknown>>;
  ttq.instance = (t: string) => {
    const e = (inst[t] ?? []) as unknown[] & Record<string, unknown>;
    for (const m of methods) defer(e, m);
    return e;
  };
  const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
  const list = [] as unknown as unknown[] & Record<string, unknown>;
  list._u = src;
  inst[id] = list;
  ((ttq._t as Record<string, number>) ??= {})[id] = Date.now();
  ((ttq._o as Record<string, unknown>) ??= {})[id] = {};
  script(`${src}?sdkid=${encodeURIComponent(id)}&lib=ttq`);
  (ttq.page as () => void)();
}

type Item = { id: string | number; price: number; qty?: number; name?: string };

/** One event to both pixels (only once she agreed and they are loaded). */
export function trackAd(event: "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase", items: Item[], opts: { value?: number; eventId?: string } = {}) {
  if (consent() !== "yes") return;
  if (!loaded) {
    // the shop's pixel ids are still on their way (or there are none: then never sent)
    if (waiting.length < 20) waiting.push(() => trackAd(event, items, opts));
    return;
  }
  const w = window as W;
  const value = opts.value ?? items.reduce((s, i) => s + i.price * (i.qty ?? 1), 0);
  // the same ids as the Meta catalogue feed (/feeds/meta.csv: item_group_id EF-P<product>)
  const ids_ = items.map((i) => `EF-P${i.id}`);
  try {
    w.fbq?.(
      "track",
      event,
      { value, currency: "DZD", content_ids: ids_, content_type: "product_group", contents: items.map((i, n) => ({ id: ids_[n], quantity: i.qty ?? 1 })), ...(items[0]?.name ? { content_name: items[0].name } : {}) },
      opts.eventId ? { eventID: opts.eventId } : undefined,
    );
    // TikTok's names: an order paid on delivery is « PlaceAnOrder »
    const tt = { ViewContent: "ViewContent", AddToCart: "AddToCart", InitiateCheckout: "InitiateCheckout", Purchase: "PlaceAnOrder" }[event];
    (w.ttq?.track as ((...a: unknown[]) => void) | undefined)?.(
      tt,
      { value, currency: "DZD", content_type: "product", contents: items.map((i, n) => ({ content_id: ids_[n], quantity: i.qty ?? 1, price: i.price })) },
      opts.eventId ? { event_id: opts.eventId } : undefined,
    );
  } catch {
    /* a blocked or broken pixel never breaks the store */
  }
}

/** Purchase once per order on this phone (the thank-you page can be opened again). */
export function trackPurchaseOnce(code: string, total: number, items: Item[]) {
  if (consent() !== "yes") return;
  const key = `elfatina.px.${code}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* counted anyway */
  }
  trackAd("Purchase", items, { value: total, eventId: code });
}
