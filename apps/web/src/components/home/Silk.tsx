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
import { Reveal, SectionHead } from "./Sections";

const onSale = (p: ProductCardDTO) => p.compareAtPrice != null && p.compareAtPrice > p.price;

/**
 * The hero, soft and calm: a pastel wash with two glows drifting slowly, the message in the
 * romantic serif, two pill buttons and the two promises that reassure most; beside it the shop's
 * photo (Admin → Page d'accueil → Apparence; pearl silk until there is one) in an arch, with a
 * small floating card. Phones: the arch first, the message under it.
 */
export function SilkHero({ sale }: { sale: boolean }) {
  const { t, href } = useLocale();
  const design = useDesign();
  const { eyebrow, title, subtitle } = useStoreTexts();
  const ref = usePauseOffscreen<HTMLElement>();
  const [delivery, payment] = t.silk.promise;
  const Truck = TRUST_ICONS.truck;
  return (
    <section ref={ref} className="wash relative isolate overflow-hidden">
      <span aria-hidden="true" className="glow -start-16 top-10 -z-10 size-64 bg-[#f6b8d6]" />
      <span aria-hidden="true" className="glow -end-10 bottom-0 -z-10 size-72 bg-[#cdb6f2] [animation-delay:-7s]" />
      <div className="mx-auto grid max-w-7xl items-center gap-5 px-6 pb-10 pt-6 md:grid-cols-[1.05fr_1fr] md:gap-14 md:px-10 md:py-20">
        <div className="order-2 text-center md:order-1 md:text-start">
          <p className="eyebrow-silk text-plum-700">{eyebrow}</p>
          <h1 className="title-silk mt-3 text-balance text-[2.2rem] text-ink md:mt-4 md:text-[4.4rem]">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft md:mx-0 md:mt-5 md:text-[17px]">{subtitle}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 md:mt-8 md:justify-start">
            <a href={href("/nouveautes")} className="btn-silk">
              {t.silk.discover}
            </a>
            {sale && (
              <a href={href("/promotions")} className="btn-silk-line text-ink">
                {t.silk.sale}
              </a>
            )}
          </div>
          {/* what reassures most, right under the buttons */}
          <ul className="mt-8 flex flex-wrap justify-center gap-2 text-[12.5px] text-ink-soft md:justify-start">
            {[delivery, payment].map((p) => (
              <li key={p!.title} className="flex items-center gap-1.5 rounded-full bg-white/70 px-3.5 py-1.5 ring-1 ring-line">
                <span aria-hidden="true" className="text-plum-600">
                  ✓
                </span>
                {p!.title}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative order-1 mx-auto w-full max-w-[11.5rem] md:order-2 md:max-w-[27rem]">
          <div className="arch relative aspect-[4/5] bg-cream shadow-[0_30px_60px_-30px_rgb(110_58_166/0.55)] ring-[7px] ring-white/70 md:ring-[10px]">
            {design.heroImage ? (
              <img src={design.heroImage} alt="" fetchPriority="high" className="size-full object-cover" />
            ) : (
              // pearl silk (Unsplash licence), sized for the arch: a phone gets the 480 px file
              <img
                src="/hero/silk-pearl-960.webp"
                srcSet="/hero/silk-pearl-480.webp 480w, /hero/silk-pearl-960.webp 960w"
                sizes="(max-width: 767px) 190px, 430px"
                alt=""
                fetchPriority="high"
                className="size-full object-cover"
              />
            )}
            {design.heroVideo && <LoopVideo src={design.heroVideo} className="absolute inset-0 size-full object-cover" />}
          </div>
          {/* a small card floating over the arch */}
          <div className="float-soft absolute -start-12 bottom-4 flex items-center gap-2.5 rounded-2xl bg-white/90 px-3 py-2 md:-start-10 md:bottom-8 md:px-3.5 md:py-2.5 shadow-soft backdrop-blur md:-start-10">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-plum-600 text-white">
              <Truck size={17} />
            </span>
            <span className="text-start leading-tight">
              <span className="block text-[12.5px] font-medium text-ink">{delivery!.title}</span>
              <span className="block text-[11px] text-ink-soft">{delivery!.text}</span>
            </span>
          </div>
          <span aria-hidden="true" className="float-soft absolute -end-2 top-6 text-2xl text-plum-600 [animation-delay:-3s]">
            ✦
          </span>
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
    <section id="nouveautes" className="mx-auto max-w-7xl scroll-mt-32 px-4 py-14 md:px-8 md:py-20">
      <SectionHead title={t.silk.trending} href={href("/nouveautes")} link={t.silk.viewAll} />
      {loading ? (
        <ProductGridSkeleton count={4} />
      ) : (
        <ul className="swipe-row -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 pt-1 md:-mx-8 md:gap-6 md:px-8">
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
 * The categories in arches: the category's photo (else one of its pieces) in an arched frame, its
 * name in the serif under it. Two across on phones, four on computers.
 */
export function CategoryBanners({ categories, products }: { categories: CategoryDTO[] | undefined; products: ProductCardDTO[] }) {
  const { t, href, ar } = useLocale();
  if (!categories) return <div className="min-h-[22rem]" aria-hidden="true" />;
  const withPieces = mainCategories(categories).filter((c) => (c.productCount ?? 0) > 0);
  const list = (withPieces.length ? withPieces : mainCategories(categories)).slice(0, 4);
  if (!list.length) return null;
  return (
    <section className="wash">
      <div className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
        <SectionHead title={t.categories.all} href={href("/categories")} link={t.silk.viewAll} />
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 md:gap-x-8">
          {list.map((c, i) => {
            const name = ar ? c.nameAr : c.nameFr;
            const slugs = categorySlugs(categories, c.slug);
            const sample = c.image ? null : products.find((p) => p.image && p.categorySlug && slugs.has(p.categorySlug));
            return (
              <li key={c.id}>
                <Reveal delay={i * 90}>
                  <a href={href(`/c/${c.slug}`)} className="card-lift group block text-center">
                    <span className="card-photo arch relative block aspect-[3/4] bg-white ring-[6px] ring-white">
                      {c.image ? (
                        <img src={c.image} alt="" loading="lazy" className="size-full object-cover" />
                      ) : sample ? (
                        <ProductImage image={sample.image} alt="" sizes="(min-width: 768px) 25vw, 50vw" className="size-full" />
                      ) : (
                        <span aria-hidden="true" className="grid size-full place-items-center bg-gradient-to-b from-[#fbe3ef] to-[#ece0fb] text-4xl text-plum-600">
                          ✦
                        </span>
                      )}
                    </span>
                    <span className="title-silk mt-4 block text-[1.35rem] text-ink md:text-[1.6rem]">{name}</span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.14em] text-plum-700">
                      {t.silk.discover}
                      <span aria-hidden="true" className="transition group-hover:translate-x-0.5 rtl:rotate-180">
                        →
                      </span>
                    </span>
                  </a>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** "La sélection": the same grid with three soft pill tabs (new in, best sellers, promotions). */
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
    <section id="promos" className="mx-auto max-w-7xl scroll-mt-32 px-4 py-14 md:px-8 md:py-20">
      <SectionHead title={t.silk.selection} />
      <div role="tablist" aria-label={t.silk.selection} className="mb-10 flex flex-wrap justify-center gap-2">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full px-5 py-2.5 text-[13px] transition ${tab === k ? "bg-plum-600 text-white shadow-[0_10px_22px_-12px_rgb(158_58_146/0.8)]" : "bg-white text-ink ring-1 ring-line hover:ring-plum-600/40"}`}
          >
            {T[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel">{loading ? <ProductGridSkeleton count={4} /> : <ProductGrid products={shown} />}</div>
      <p className="mt-12 text-center">
        <a href={href(tab === "sale" ? "/promotions" : "/nouveautes")} className="btn-silk-line text-ink">
          {t.silk.viewAll}
        </a>
      </p>
    </section>
  );
}

/** The promises as soft white cards on the wash: delivery, payment, exchange, advice. */
export function PromiseRow() {
  const { t } = useLocale();
  const icons = [TRUST_ICONS.truck, TRUST_ICONS.cash, TRUST_ICONS.swap, null];
  return (
    <section className="wash">
      <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 py-14 md:grid-cols-4 md:gap-6 md:px-8 md:py-16">
        {t.silk.promise.map((p, i) => {
          const Icon = icons[i];
          return (
            <li key={p.title}>
              <Reveal delay={i * 80} className="h-full">
                <div className="h-full rounded-3xl bg-white/85 p-5 text-center shadow-soft ring-1 ring-white md:p-7">
                  <span aria-hidden="true" className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-plum-600 text-white shadow-[0_10px_22px_-10px_rgb(158_58_146/0.8)]">
                    {Icon ? <Icon size={21} /> : <span className="text-base">✦</span>}
                  </span>
                  <p className="text-[14px] font-medium text-ink">{p.title}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{p.text}</p>
                </div>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "À explorer": the shop's other doors, as soft rounded tiles. */
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
    <section className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
      <SectionHead title={t.silk.explore} />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
        {items.map(([to, label]) => (
          <li key={to}>
            <a href={href(to)} className="card-lift group flex h-24 flex-col items-center justify-center gap-2 rounded-3xl bg-white px-3 text-center shadow-soft ring-1 ring-line md:h-32">
              <span className="title-silk text-[1.15rem] text-ink md:text-[1.4rem]">{label}</span>
              <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-plum-600 transition-all group-hover:w-14" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
