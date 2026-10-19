import { Fragment, type ReactNode } from "react";
import type { CategoryDTO, HomeSectionKey, ProductCardDTO } from "@elfatina/shared";
import { ErrorBox } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useDesign, useSite } from "@/lib/site";
import { DropBanner } from "@/components/views/DropViews";
import { Banners, Featured, FlashBlock, Newsletter } from "./HomeExtras";
import { Faq, InstagramCard } from "./Sections";
import { ContestCard, LookbookGrid, RecentlyViewed, ReviewWall } from "./Showcase";
import { CategoryBanners, ExploreGrid, PromiseRow, SelectionTabs, SilkHero, TrendingRail } from "./Silk";

/**
 * Home, silk-shop style: the hero, the trending row, the large category banners, the selection
 * with its tabs, the promises on cream, then reviews, Instagram, the questions and "à explorer".
 * The order and which blocks show are set in Admin → Page d'accueil → Sections.
 */
export function HomePage() {
  const { t } = useLocale();
  const site = useSite();
  const design = useDesign();
  const catalog = useApi<ProductCardDTO[]>("/catalog");
  const categories = useApi<CategoryDTO[]>("/categories");

  const products = catalog.data ?? [];
  const loading = !catalog.data;
  const sale = products.some((p) => p.compareAtPrice != null && p.compareAtPrice > p.price);

  const blocks: Record<HomeSectionKey, () => ReactNode> = {
    hero: () => <SilkHero sale={sale} />,
    // the trending row; nothing online yet: a card the size of the loading row (the page doesn't jump)
    new: () =>
      catalog.error ? (
        <div className="mx-auto max-w-7xl px-3 py-12 md:px-6">
          <ErrorBox onRetry={catalog.reload} />
        </div>
      ) : !loading && !products.length ? (
        <section id="nouveautes" className="mx-auto max-w-7xl px-3 py-12 md:px-6">
          <div className="grid min-h-[22rem] place-items-center bg-cream p-8 text-center">
            <div>
              <p className="title-silk text-xl">{t.home.comingSoon}</p>
              <a href="https://www.instagram.com/el_fatina_/" target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
                {t.home.comingSoonHint}
              </a>
            </div>
          </div>
        </section>
      ) : (
        <TrendingRail products={products} loading={loading} />
      ),
    stories: () => <CategoryBanners categories={categories.data} products={products} />,
    drop: () => site.data?.drop && <DropBanner drop={site.data.drop} />,
    flash: () => <FlashBlock products={products} />,
    promos: () => <SelectionTabs products={products} loading={loading} />,
    banners: () => <Banners />,
    featured: () => <Featured products={products} />,
    promise: () => <PromiseRow />,
    reviews: () => <ReviewWall />,
    // the photos and the follow card: one block
    instagram: () => (
      <InstagramCard>
        <LookbookGrid />
      </InstagramCard>
    ),
    contest: () => <ContestCard />,
    recent: () => <RecentlyViewed products={products} />,
    faq: () => <Faq />,
    newsletter: () => <Newsletter />,
    best: () => <ExploreGrid />,
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
