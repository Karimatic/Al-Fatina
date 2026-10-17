import { Fragment, type ReactNode } from "react";
import type { CategoryDTO, HomeSectionKey, ProductCardDTO } from "@henine/shared";
import { ProductGrid, ProductGridSkeleton } from "@/components/product/ProductCard";
import { ErrorBox } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useDesign, useSite } from "@/lib/site";
import { useStoreTexts } from "@/lib/storeTexts";
import { DropBanner } from "@/components/views/DropViews";
import { AnimatedTagline } from "./AnimatedTagline";
import { usePauseOffscreen } from "@/lib/pauseOffscreen";
import { LoopVideo } from "@/components/ui/LoopVideo";
import { Banners, Featured, FlashBlock, Newsletter } from "./HomeExtras";
import { Faq, InstagramCard, SectionHead } from "./Sections";
import { ContestCard, LookbookGrid, PromiseBand, RecentlyViewed, ReviewWall, Stories } from "./Showcase";

/**
 * Home, phone first: the shop's stories, a big photo with the promise on it, the promises,
 * then the products; the Instagram lookbook, real reviews and the questions come after.
 * The order and which blocks show are set in Admin → Page d'accueil → Sections.
 */
export function HomePage() {
  const { t, href, ar } = useLocale();
  const site = useSite();
  const design = useDesign();
  // the banner's endless animations stop once it is scrolled away
  const heroRef = usePauseOffscreen<HTMLDivElement>();
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const categories = useApi<CategoryDTO[]>("/categories");

  // built-in texts or the team's edits, always in the language of the page
  const { eyebrow, title, subtitle } = useStoreTexts();

  const products = catalog.data ?? [];
  const newest = [...products].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  // "Les plus demandées" only when real sales back it; otherwise the team's own picks
  const RANK = { bestseller: 0, trending: 1, popular: 2 } as const;
  const selling = products.filter((p) => p.badge).sort((a, b) => RANK[a.badge!] - RANK[b.badge!]).slice(0, 4);
  const picks = products.filter((p) => p.tags.includes("best-seller")).slice(0, 4);
  const favorites = selling.length ? selling : picks;
  const onSale = products.filter((p) => p.compareAtPrice != null && p.compareAtPrice > p.price).slice(0, 8);
  const heroProduct = products.find((p) => p.image && p.tags.includes("best-seller")) ?? products.find((p) => p.image);

  const blocks: Record<HomeSectionKey, () => ReactNode> = {
    stories: () => (
      <div className="pt-5 md:pt-8">
        <Stories categories={categories.data} products={products} />
      </div>
    ),
    hero: () => (
      /* Hero: the shop's photo, the promise centred on it */
      <section className="px-3 pt-3 md:px-4">
        <div ref={heroRef} className="relative mx-auto flex min-h-[19.5rem] max-w-6xl flex-col items-center justify-end overflow-hidden rounded-[1.75rem] bg-noir text-center md:min-h-[34rem] md:justify-center md:rounded-[2.25rem]">
          {/* cinematic: the shop's photo drifting slowly (or, by default, two silks
              cross-fading), under a warm grade, a vignette, film grain and a light sweep */}
          {design.heroImage ? (
            <img src={design.heroImage} alt="" fetchPriority="high" className="hero-cine-img hero-cine-solo" />
          ) : (
            // no photo uploaded yet: rose and pearl silk (Unsplash licence), cross-fading slowly
            <>
              {/* sized for the screen (a phone gets ≤ 44 KB instead of 228 KB); phones show the first
                  one only (no cross-fade: the second photo became the slowest paint) */}
              <img
                src="/hero/silk-rose-960.webp"
                srcSet="/hero/silk-rose-480.webp 480w, /hero/silk-rose-960.webp 960w, /hero/silk-rose-1600.webp 1600w"
                sizes="(max-width: 767px) 50vw, (max-width: 1280px) 100vw, 1200px"
                alt=""
                fetchPriority="high"
                className="hero-cine-img hero-cine-a"
              />
              <img
                src="/hero/silk-pearl-960.webp"
                srcSet="/hero/silk-pearl-480.webp 480w, /hero/silk-pearl-960.webp 960w, /hero/silk-pearl-1600.webp 1600w"
                sizes="(max-width: 1280px) 100vw, 1200px"
                alt=""
                loading="lazy"
                className="hero-cine-img hero-cine-b max-md:hidden"
              />
            </>
          )}
          {design.heroVideo && <LoopVideo src={design.heroVideo} />}
          <div aria-hidden="true" className={`hero-grade absolute inset-0 ${design.heroImage ? "" : "opacity-75"}`} />
          <div aria-hidden="true" className="hero-sweep pointer-events-none absolute inset-0" />
          <div aria-hidden="true" className="hero-grain pointer-events-none absolute -inset-[10%]" />
          <div aria-hidden="true" className="hero-frame pointer-events-none absolute" />
          {/* phones: compact, so the first products come sooner (audit PERF-1 / UX-3) */}
          <div className="relative flex w-full max-w-2xl flex-col items-center px-5 pb-5 pt-6 text-white md:p-12">
            <p className="mb-3 inline-flex md:mb-4 items-center gap-2 rounded-full border border-[#e9c98f]/40 bg-black/35 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#f3dcb0]">
              <span className="size-1.5 animate-pulse rounded-full bg-[#e9c98f]" aria-hidden="true" />
              {eyebrow}
            </p>
            {/* two lines kept on phones: the fallback font fits the title on one line, the real one
                on two (the banner grew when it arrived) */}
            <AnimatedTagline key={title} text={title} tone="light" className="text-balance text-[1.9rem] leading-[1.1] max-md:min-h-[2.2em] md:text-6xl" />
            <p className="mt-2 line-clamp-2 max-w-md text-sm leading-relaxed text-white/85 md:mt-3 md:line-clamp-none md:text-lg">{subtitle}</p>
            <div className="mt-4 flex flex-col items-center gap-1 md:mt-6 md:gap-2">
              <a href="#nouveautes" className="lift inline-flex h-12 items-center justify-center rounded-full bg-white px-8 font-semibold text-noir">
                {t.hero.cta}
              </a>
              {/* its line is kept from the first paint (it appearing with the products moved the page) */}
              {!heroProduct && <span className="h-9 md:h-10" aria-hidden="true" />}
              {heroProduct && (
                <a href={href(`/produit/${heroProduct.slug}`)} className="inline-flex h-9 items-center gap-1.5 text-sm font-semibold text-white/85 underline-offset-4 hover:underline md:h-10">
                  {ar ? heroProduct.nameAr : heroProduct.nameFr}
                  <span aria-hidden="true" className="rtl:rotate-180">→</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    ),
    promise: () => (
      <div className="py-3 md:py-4">
        <PromiseBand />
      </div>
    ),
    drop: () => site.data?.drop && <DropBanner drop={site.data.drop} />,
    flash: () => <FlashBlock products={products} />,
    /* New arrivals: the products, right away */
    new: () => (
      <section id="nouveautes" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-6">
        <SectionHead title={t.home.newArrivals} href={href("/nouveautes")} link={t.home.seeAll} />
        {catalog.error ? (
          <ErrorBox onRetry={catalog.reload} />
        ) : !catalog.data ? (
          <ProductGridSkeleton count={4} />
        ) : newest.length ? (
          <ProductGrid products={newest} />
        ) : (
          // nothing online yet: a card the size of the loading one (the page doesn't jump, R5-3)
          <div className="grid min-h-[32rem] place-items-center rounded-card border border-dashed border-line bg-surface/60 p-8 text-center md:min-h-[22rem]">
            <div>
              <p className="text-lg font-semibold">{t.home.comingSoon}</p>
              <a href="https://www.instagram.com/henine.boutique/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-plum-700 underline underline-offset-2">
                {t.home.comingSoonHint}
              </a>
            </div>
          </div>
        )}
      </section>
    ),
    banners: () => <Banners />,
    featured: () => <Featured products={products} />,
    promos: () =>
      onSale.length > 0 && (
        <section id="promos" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-6">
          <SectionHead title={t.home.promos} />
          <ProductGrid products={onSale} />
        </section>
      ),
    best: () =>
      favorites.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-6">
          <SectionHead title={(selling.length ? t.home.bestSellers : t.badges.pick) ?? t.home.bestSellers} />
          <ProductGrid products={favorites} />
        </section>
      ),
    // the photos and the follow card: one block
    instagram: () => (
      <InstagramCard>
        <LookbookGrid />
      </InstagramCard>
    ),
    contest: () => <ContestCard />,
    reviews: () => <ReviewWall />,
    recent: () => <RecentlyViewed products={products} />,
    faq: () => <Faq />,
    newsletter: () => <Newsletter />,
  };

  return (
    <>
      {design.sections
        .filter((s) => s.on)
        .map((s) => (
          <Fragment key={s.key}>{blocks[s.key]?.()}</Fragment>
        ))}
    </>
  );
}
