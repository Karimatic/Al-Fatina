import { useEffect, useState } from "react";
import { LoopVideo } from "@/components/ui/LoopVideo";
import type { FlashInfoDTO, ProductCardDTO } from "@elfatina/shared";
import { ProductGrid } from "@/components/product/ProductCard";
import { InstagramIcon } from "@/components/ui/icons";
import { Countdown, useCountdown } from "@/components/views/DropViews";
import { useLocale } from "@/lib/locale";
import { pushSupported, subscribeNews } from "@/lib/push";
import { useDesign, useSite } from "@/lib/site";
import { Reveal, SectionHead } from "./Sections";

/* ───────── ⚡ Flash sale: countdown + its products ───────── */

export function FlashBlock({ products }: { products: ProductCardDTO[] }) {
  const { t, ar } = useLocale();
  const sale = useSite().data?.flash;
  const { left, done } = useCountdown(sale?.endsAt ?? null);
  if (!sale || done) return null;
  const list = products.filter((p) => p.flash?.saleId === sale.id);
  if (!list.length) return null;
  return (
    <section id="flash" className="mx-auto max-w-6xl scroll-mt-32 px-3 py-6 md:px-4">
      <div className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-noir via-plum-700 to-plum-600 p-4 text-white md:p-7">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em]">
              <span className="animate-pulse" aria-hidden="true">⚡</span> {t.plus.flash.title} · -{sale.percent}%
            </p>
            <h2 className="heading-display mt-2 text-3xl md:text-4xl">{ar ? sale.nameAr : sale.nameFr}</h2>
          </div>
          <div className="text-end">
            <p className="mb-1 text-xs font-medium text-white/75">{t.plus.flash.endsIn}</p>
            <Countdown left={left} />
          </div>
        </div>
        <div className="rounded-[1.25rem] bg-ivory p-3 text-ink md:p-4">
          <ProductGrid products={list.slice(0, 8)} />
        </div>
      </div>
    </section>
  );
}

/** Product page / card: how much is left at the sale price. */
export function FlashStock({ flash, compact = false }: { flash: FlashInfoDTO; compact?: boolean }) {
  const { t } = useLocale();
  if (flash.limit == null) return compact ? null : <p className="text-xs font-medium text-rose-700">🔥 {t.plus.flash.hot}</p>;
  const left = Math.max(0, flash.limit - flash.sold);
  const pct = Math.min(100, Math.round((flash.sold / flash.limit) * 100));
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="text-rose-700">🔥 {t.plus.flash.left(left)}</span>
        {!compact && <span className="text-ink-soft">{t.plus.flash.sold(flash.sold, flash.limit)}</span>}
      </div>
      <span className="block h-2 overflow-hidden rounded-full bg-rose-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-sale" style={{ width: `${Math.max(6, pct)}%` }} />
      </span>
    </div>
  );
}

/** Product page panel: ⚡ -30 %, ends in 02:31:48, pieces left. */
export function FlashPanel({ flash }: { flash: FlashInfoDTO }) {
  const { t } = useLocale();
  const { left, done } = useCountdown(flash.endsAt);
  if (done) return null;
  return (
    <div className="mt-4 bg-plum-600 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">⚡ {t.plus.flash.title} · -{flash.percent}%</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/75">{t.plus.flash.endsIn}</span>
          <Countdown left={left} />
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-surface/95 p-3 text-ink">
        <FlashStock flash={flash} />
      </div>
    </div>
  );
}

/* ───────── Banners (Admin → Apparence) ───────── */

export function Banners() {
  const { ar, href } = useLocale();
  const banners = useDesign().banners;
  if (!banners.length) return null;
  const link = (l: string) => (!l ? undefined : l.startsWith("/") ? href(l) : l);
  return (
    <section className="mx-auto max-w-6xl px-3 py-5 md:px-4">
      <ul className={`grid gap-3 ${banners.length > 1 ? "md:grid-cols-2" : ""}`}>
        {banners.map((b, i) => {
          const title = ar ? b.titleAr || b.titleFr : b.titleFr || b.titleAr;
          const subtitle = ar ? b.subtitleAr || b.subtitleFr : b.subtitleFr || b.subtitleAr;
          const external = !!b.link && !b.link.startsWith("/");
          return (
            <li key={b.id}>
              <Reveal delay={i * 80}>
                <a
                  href={link(b.link)}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="group relative block aspect-[16/9] overflow-hidden rounded-[1.5rem] bg-noir md:aspect-[2/1]"
                >
                  {b.image && <img src={b.image} alt={title} loading="lazy" className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105" />}
                  {b.video && <LoopVideo src={b.video} still={!b.image} />}
                  {(title || subtitle) && (
                    <>
                      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-noir/80 via-noir/20 to-transparent" />
                      <span className="absolute inset-x-0 bottom-0 p-5 text-white">
                        {title && <span className="heading-display block text-2xl md:text-3xl">{title}</span>}
                        {subtitle && <span className="mt-1 block text-sm text-white/85">{subtitle}</span>}
                      </span>
                    </>
                  )}
                </a>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ───────── Hand-picked products ───────── */

export function Featured({ products }: { products: ProductCardDTO[] }) {
  const { ar } = useLocale();
  const f = useDesign().featured;
  const list = f.productIds.map((id) => products.find((p) => p.id === id)).filter((p): p is ProductCardDTO => !!p);
  if (!list.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <SectionHead title={(ar ? f.titleAr || f.titleFr : f.titleFr || f.titleAr) || "⭐"} />
      <ProductGrid products={list} />
    </section>
  );
}

/* ───────── "Recevoir les nouveautés" (push, no e-mail) ───────── */

export function Newsletter() {
  const { t, locale } = useLocale();
  const N = t.plus.newsletter;
  const site = useSite();
  const [state, setState] = useState<"idle" | "busy" | "done" | "denied" | "ios" | "error">("idle");
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches;
    if (!pushSupported()) {
      setSupported(false);
      if (ios && !standalone) setState("ios");
    }
  }, []);
  const ig = site.data?.contact.instagram ?? "https://www.instagram.com/el_fatina_/";
  return (
    <section className="mx-auto max-w-6xl px-3 py-6 md:px-4">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-plum-600 px-6 py-10 text-center text-white md:px-12 md:py-14">
          <span aria-hidden="true" className="glow -end-10 -top-16 size-60 bg-white/40" />
          <span aria-hidden="true" className="glow -bottom-20 -start-10 size-60 bg-[#f6b8d6]/60 [animation-delay:-6s]" />
          <p className="relative text-3xl" aria-hidden="true">💌</p>
          <h2 className="title-silk relative mt-3 text-[2.2rem] md:text-[3rem]">{N.title}</h2>
          <p className="relative mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white">{N.text}</p>
          {state === "done" ? (
            <p className="relative mt-6 font-medium">{N.done}</p>
          ) : state === "ios" ? (
            <p className="relative mx-auto mt-6 max-w-sm text-sm font-medium">{N.ios}</p>
          ) : supported ? (
            <button
              type="button"
              disabled={state === "busy"}
              onClick={async () => {
                setState("busy");
                const r = await subscribeNews(locale);
                setState(r === "ok" ? "done" : r === "denied" ? "denied" : "error");
              }}
              className="relative mt-7 inline-flex h-12 items-center rounded-full bg-white px-8 text-[13px] font-medium uppercase tracking-[0.12em] text-plum-700 shadow-[0_12px_28px_-12px_rgb(0_0_0/0.4)] transition hover:-translate-y-px disabled:opacity-60"
            >
              {N.cta}
            </button>
          ) : null}
          {state === "denied" && <p className="mt-2 text-sm text-danger">{N.denied}</p>}
          {state === "error" && <p className="mt-2 text-sm text-danger">{t.common.error}</p>}
          <a href={ig} target="_blank" rel="noopener noreferrer" className="relative mt-5 flex items-center justify-center gap-1.5 text-sm font-medium text-white underline-offset-4 hover:underline">
            <InstagramIcon size={16} /> {N.instagram}
          </a>
        </div>
      </Reveal>
    </section>
  );
}
