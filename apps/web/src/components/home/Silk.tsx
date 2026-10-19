import { useState } from "react";
import { categorySlugs, mainCategories, type CategoryDTO, type ProductCardDTO } from "@elfatina/shared";
import { ProductCard, ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { TRUST_ICONS } from "@/components/ui/icons";
import { ProductImage } from "@/components/ui/kit";
import { LoopVideo } from "@/components/ui/LoopVideo";
import { useLocale } from "@/lib/locale";
import { useDesign } from "@/lib/site";
import { useStoreTexts } from "@/lib/storeTexts";
import { usePauseOffscreen } from "@/lib/pauseOffscreen";
import { SectionHead } from "./Sections";

const onSale = (p: ProductCardDTO) => p.compareAtPrice != null && p.compareAtPrice > p.price;

/**
 * The hero, edge to edge: the shop's photo (Admin → Page d'accueil → Apparence) or, until there is
 * one, pearl silk; the message on the start side over a soft shade, two buttons. Phones: a tall
 * photo with the message at its foot.
 */
export function SilkHero({ sale }: { sale: boolean }) {
  const { t, href } = useLocale();
  const design = useDesign();
  const { eyebrow, title, subtitle } = useStoreTexts();
  const ref = usePauseOffscreen<HTMLElement>();
  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-cream">
      {design.heroImage ? (
        <img src={design.heroImage} alt="" fetchPriority="high" className="absolute inset-0 -z-10 size-full object-cover" />
      ) : (
        // pearl silk (Unsplash licence), sized for the screen: a phone gets the 480 px file
        <img
          src="/hero/silk-pearl-960.webp"
          srcSet="/hero/silk-pearl-480.webp 480w, /hero/silk-pearl-960.webp 960w, /hero/silk-pearl-1600.webp 1600w"
          sizes="100vw"
          alt=""
          fetchPriority="high"
          className="absolute inset-0 -z-10 size-full object-cover"
        />
      )}
      {design.heroVideo && <LoopVideo src={design.heroVideo} className="absolute inset-0 -z-10 size-full object-cover" />}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-[#3d2a30]/70 via-[#b04f68]/20 to-transparent md:bg-gradient-to-r md:from-[#3d2a30]/60 md:via-[#b04f68]/15 rtl:md:bg-gradient-to-l" />
      <div className="mx-auto flex min-h-[34rem] max-w-7xl flex-col justify-end px-6 pb-10 text-white md:min-h-[40rem] md:justify-center md:px-12 md:pb-0">
        <p className="eyebrow-silk text-white/90">{eyebrow}</p>
        <h1 className="title-silk mt-3 max-w-xl text-balance text-[2rem] leading-[1.15] md:text-[3.4rem]">{title}</h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/90 md:text-base">{subtitle}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={href("/nouveautes")} className="btn-silk bg-white text-ink hover:bg-white/90">
            {t.silk.discover}
          </a>
          {sale && (
            <a href={href("/promotions")} className="btn-silk-line text-white hover:bg-white hover:text-ink">
              {t.silk.sale}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Tendances du moment": the pieces that sell (else the newest), a row that slides sideways. */
export function TrendingRail({ products, loading }: { products: ProductCardDTO[]; loading: boolean }) {
  const { t, href } = useLocale();
  const RANK = { bestseller: 0, trending: 1, popular: 2 } as const;
  const selling = products.filter((p) => p.badge).sort((a, b) => RANK[a.badge!] - RANK[b.badge!]);
  const newest = [...products].sort((a, b) => b.createdAt - a.createdAt);
  const list = [...selling, ...newest.filter((p) => !selling.includes(p))].slice(0, 10);
  if (!loading && !list.length) return null;
  return (
    <section id="nouveautes" className="mx-auto max-w-7xl scroll-mt-32 px-3 py-12 md:px-6 md:py-16">
      <SectionHead title={t.silk.trending} href={href("/nouveautes")} link={t.silk.viewAll} />
      {loading ? (
        <ProductGridSkeleton count={4} />
      ) : (
        <ul className="swipe-row -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 md:-mx-6 md:gap-6 md:px-6">
          {list.map((p, i) => (
            <li key={p.id} className="w-[46%] shrink-0 sm:w-[31%] lg:w-[23%]">
              <ProductCard p={p} priority={i < 2} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Large category banners, two side by side: the category's photo (else one of its pieces) with
 * its name in capitals over it and "Découvrir".
 */
export function CategoryBanners({ categories, products }: { categories: CategoryDTO[] | undefined; products: ProductCardDTO[] }) {
  const { t, href, ar } = useLocale();
  if (!categories) return <div className="min-h-[22rem]" aria-hidden="true" />;
  const withPieces = mainCategories(categories).filter((c) => (c.productCount ?? 0) > 0);
  const list = (withPieces.length ? withPieces : mainCategories(categories)).slice(0, 4);
  if (!list.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-3 py-6 md:px-6">
      <ul className="grid grid-cols-2 gap-3 md:gap-6">
        {list.map((c) => {
          const name = ar ? c.nameAr : c.nameFr;
          const slugs = categorySlugs(categories, c.slug);
          const sample = c.image ? null : products.find((p) => p.image && p.categorySlug && slugs.has(p.categorySlug));
          return (
            <li key={c.id}>
              <a href={href(`/c/${c.slug}`)} className="group relative block aspect-[4/5] overflow-hidden bg-cream md:aspect-[4/3]">
                {c.image ? (
                  <img src={c.image} alt="" loading="lazy" className="size-full object-cover transition duration-700 group-hover:scale-[1.03]" />
                ) : sample ? (
                  <ProductImage image={sample.image} alt="" sizes="50vw" className="size-full transition duration-700 group-hover:scale-[1.03]" />
                ) : null}
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#3d2a30]/60 via-[#b04f68]/5 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex flex-col items-center p-4 text-center text-white md:p-8">
                  <span className="title-silk text-[1rem] md:text-2xl">{name}</span>
                  <span className="mt-2 text-[10.5px] uppercase tracking-[0.18em] underline underline-offset-[6px] md:text-xs">{t.silk.discover}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "La sélection": the same grid with three tabs (new in, best sellers, promotions). */
export function SelectionTabs({ products, loading }: { products: ProductCardDTO[]; loading: boolean }) {
  const { t, href } = useLocale();
  const T = t.silk.tabs;
  const lists = {
    new: [...products].sort((a, b) => b.createdAt - a.createdAt),
    best: products.filter((p) => p.badge || p.tags.includes("best-seller")),
    sale: products.filter(onSale),
  };
  const tabs = (["new", "best", "sale"] as const).filter((k) => k === "new" || lists[k].length > 0);
  const [tab, setTab] = useState<(typeof tabs)[number]>("new");
  const shown = lists[tab].slice(0, 8);
  if (!loading && !products.length) return null;
  return (
    <section id="promos" className="mx-auto max-w-7xl scroll-mt-32 px-3 py-12 md:px-6 md:py-16">
      <SectionHead title={t.silk.selection} />
      <div role="tablist" aria-label={t.silk.selection} className="mb-8 flex justify-center gap-6">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`border-b pb-1.5 text-[12px] uppercase tracking-[0.14em] transition ${tab === k ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {T[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel">{loading ? <ProductGridSkeleton count={4} /> : <ProductGrid products={shown} />}</div>
      <p className="mt-10 text-center">
        <a href={href(tab === "sale" ? "/promotions" : "/nouveautes")} className="btn-silk-line text-ink">
          {t.silk.viewAll}
        </a>
      </p>
    </section>
  );
}

/** The promises on cream: delivery, payment, exchange, advice. */
export function PromiseRow() {
  const { t } = useLocale();
  const icons = [TRUST_ICONS.truck, TRUST_ICONS.cash, TRUST_ICONS.swap, null];
  return (
    <section className="bg-cream">
      <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-x-4 gap-y-8 px-6 py-12 md:grid-cols-4 md:py-14">
        {t.silk.promise.map((p, i) => {
          const Icon = icons[i];
          return (
            <li key={p.title} className="text-center">
              <span aria-hidden="true" className="mx-auto mb-3 grid size-11 place-items-center rounded-full border border-gold/60 text-gold">
                {Icon ? <Icon size={20} /> : <span className="text-sm">✦</span>}
              </span>
              <p className="text-[12px] font-medium uppercase tracking-[0.14em]">{p.title}</p>
              <p className="mt-1.5 text-[13px] text-ink-soft">{p.text}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "À explorer": the shop's other doors, as quiet cream tiles. */
export function ExploreGrid() {
  const { t, href } = useLocale();
  const items: [string, string][] = [
    ["/nouveautes", t.silk.newIn],
    ["/promotions", t.silk.sale],
    ["/categories", t.categories.all],
    ["/tenue", t.plus.outfit.link],
    ["/suivi", t.silk.track],
    ["/contact", t.footer.contact],
  ];
  return (
    <section className="mx-auto max-w-7xl px-3 py-12 md:px-6 md:py-16">
      <SectionHead title={t.silk.explore} />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-6">
        {items.map(([to, label]) => (
          <li key={to}>
            <a href={href(to)} className="group flex h-24 flex-col items-center justify-center gap-2 border border-line bg-cream px-3 text-center transition hover:border-ink md:h-32">
              <span className="text-[12px] uppercase tracking-[0.14em] md:text-[13px]">{label}</span>
              <span aria-hidden="true" className="h-px w-8 bg-gold transition-all group-hover:w-14" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
