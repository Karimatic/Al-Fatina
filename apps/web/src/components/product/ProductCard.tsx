import type { ProductCardDTO } from "@elfatina/shared";
import { HeartIcon } from "@/components/ui/icons";
import { Price, ProductImage, Stars } from "@/components/ui/kit";
import { useLocale } from "@/lib/locale";
import { FlashStock } from "@/components/home/HomeExtras";
import { Badges } from "./Badges";
import { QuickAddButton } from "./QuickAdd";
import { toggleFavorite, useFavorites } from "@/lib/stores";

/** `level`: heading level of the product name: 3 under a section title, 2 right under the page title. */
export function ProductCard({ p, priority = false, level = 3 }: { p: ProductCardDTO; priority?: boolean; level?: 2 | 3 }) {
  const Name = level === 2 ? "h2" : "h3";
  const { t, href, ar } = useLocale();
  const favorites = useFavorites();
  const fav = favorites.includes(p.slug);
  const name = ar ? p.nameAr : p.nameFr;

  return (
    <article className="group relative">
      {/* plain <a>: product pages are separate static shells (full navigation, cached at the edge) */}
      <a href={href(`/produit/${p.slug}`)} className="block">
        <div className="relative">
          <ProductImage image={p.image} alt={name} category={p.categorySlug} color={p.colors[0]} priority={priority} className="aspect-[3/4] transition duration-500 group-hover:opacity-90" />
          <div className="pointer-events-none absolute start-0 top-3 flex flex-col items-start gap-1">
            {p.flash && p.inStock && (
              <span className="bg-sale px-2 py-0.5 text-[11px] font-medium text-white" dir="ltr">
                ⚡ -{p.flash.percent}%
              </span>
            )}
            {p.inStock ? <Badges p={p} className="flex-col items-start" /> : <span className="bg-ink/85 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-white">{t.product.outOfStock}</span>}
          </div>
        </div>
        <div className="mt-3 space-y-1 px-0.5 text-center">
          <Name className="line-clamp-1 text-[13.5px] text-ink">{name}</Name>
          <Price value={p.price} compareAt={p.compareAtPrice} className="justify-center text-[13.5px]" />
          {p.flash?.limit != null && p.inStock && <FlashStock flash={p.flash} compact />}
          <div className="flex items-center justify-center gap-2">
            {p.colors.length > 0 && (
              <span className="flex -space-x-1 rtl:space-x-reverse" aria-hidden="true">
                {p.colors.slice(0, 4).map((c) => (
                  <span key={c} className="size-3.5 rounded-full border border-white shadow-sm" style={{ background: c }} />
                ))}
              </span>
            )}
            {p.rating && (
              <span className="flex items-center gap-1 text-[11px] text-ink-soft">
                <Stars value={p.rating.avg} size={11} />({p.rating.count})
              </span>
            )}
          </div>
        </div>
      </a>
      <button
        type="button"
        onClick={() => toggleFavorite(p.slug)}
        aria-pressed={fav}
        aria-label={fav ? t.product.favoriteRemove : t.product.favoriteAdd}
        className={`absolute end-2 top-2 grid size-9 place-items-center rounded-full bg-white/85 transition active:scale-90 ${fav ? "text-sale" : "text-ink"}`}
      >
        <HeartIcon size={18} fill={fav ? "currentColor" : "none"} />
      </button>
      <div className="absolute inset-x-0 top-0 aspect-[3/4]" style={{ pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>
          <QuickAddButton p={p} />
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 md:gap-x-6 md:gap-y-12 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="skeleton aspect-[3/4]" />
          <div className="skeleton mx-auto mt-3 h-4 w-3/4" />
          <div className="skeleton mx-auto mt-1.5 h-4 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

export function ProductGrid({ products, level = 3 }: { products: ProductCardDTO[]; level?: 2 | 3 }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 md:gap-x-6 md:gap-y-12 lg:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard p={p} priority={i < 2} level={level} />
        </li>
      ))}
    </ul>
  );
}
