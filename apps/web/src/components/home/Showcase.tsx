import type { ProductCardDTO, ReviewWallDTO } from "@elfatina/shared";
import { ProductGrid } from "@/components/product/ProductCard";
import { InstagramIcon } from "@/components/ui/icons";
import { Stars } from "@/components/ui/kit";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useRecent } from "@/lib/stores";
import { Reveal, SectionHead } from "./Sections";

const IG = "https://www.instagram.com/el_fatina_/";

/* ───────── Lookbook: the shop's Instagram posts ───────── */

// Al Fatina's own Instagram photos go in apps/web/public/ig/ and are listed here (6 square
// JPGs, the first shown large). Empty: the Instagram block shows no photo grid.
const LOOKS: string[] = [];

/** The shop's Instagram photos (shown inside the Instagram card). */
export function LookbookGrid() {
  if (LOOKS.length === 0) return null;
  return (
    <ul className="grid grid-cols-3 gap-1.5 md:grid-cols-6 md:gap-3">
        {LOOKS.map((src, i) => (
          <li key={src} className={i === 0 ? "col-span-2 row-span-2 md:col-span-2" : ""}>
            <Reveal delay={i * 70} className="h-full">
              <a href={IG} target="_blank" rel="noopener noreferrer" className="group relative block h-full overflow-hidden rounded-2xl bg-ivory-deep" aria-label="Instagram">
                <img src={src} alt="" loading="lazy" className={`w-full object-cover transition duration-700 group-hover:scale-110 ${i === 0 ? "aspect-square h-full" : "aspect-square"}`} />
                <span className="absolute inset-0 grid place-items-center bg-noir/0 text-white opacity-0 transition group-hover:bg-noir/35 group-hover:opacity-100">
                  <InstagramIcon size={28} />
                </span>
              </a>
            </Reveal>
          </li>
        ))}
    </ul>
  );
}

/* ───────── Contests (Instagram) ───────── */

export function ContestCard() {
  const { t } = useLocale();
  const C = t.home.contest;
  // a light card: the gift in a gradient circle, the title in the serif, a pill to join
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <Reveal>
        <a href={IG} target="_blank" rel="noopener noreferrer" className="card-lift group flex flex-col items-center gap-5 rounded-[2rem] bg-white p-6 text-center shadow-soft ring-1 ring-line md:flex-row md:p-8 md:text-start">
          <span aria-hidden="true" className="float-soft grid size-20 shrink-0 place-items-center rounded-full bg-plum-600 text-3xl shadow-[0_14px_30px_-12px_rgb(158_58_146/0.8)]">
            🎁
          </span>
          <span className="min-w-0 flex-1">
            <span className="eyebrow-silk block text-plum-700">{C.eyebrow}</span>
            <span className="title-silk mt-1 block text-[1.9rem] text-ink md:text-[2.4rem]">{C.title}</span>
            <span className="mt-1 block text-[14.5px] text-ink-soft">{C.text}</span>
          </span>
          <span className="btn-silk-line shrink-0 text-ink group-hover:bg-plum-600 group-hover:text-white">
            Instagram
            <span aria-hidden="true" className="rtl:rotate-180">→</span>
          </span>
        </a>
      </Reveal>
    </section>
  );
}

/* ───────── Review wall: verified reviews from every product ───────── */

export function ReviewWall() {
  const { t, href, ar } = useLocale();
  const R = t.home.reviews;
  const { data } = useApi<ReviewWallDTO>("/reviews");
  if (!data || !data.count || !data.reviews.length) return null;
  return (
    <section className="bg-ivory-deep/70 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 px-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">{R.eyebrow}</p>
          <h2 className="heading-display mt-1 text-[1.65rem] leading-tight md:text-4xl">{R.title}</h2>
          {data.avg != null && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm shadow-sm">
              <b className="text-lg" dir="ltr">{data.avg.toFixed(1)}</b>
              <Stars value={data.avg} size={16} />
              <span className="text-ink-soft">{R.based(data.count)}</span>
            </p>
          )}
        </div>
        <ul className="swipe-row flex gap-3 overflow-x-auto px-4 pb-2 md:grid md:grid-cols-3 md:overflow-visible">
          {data.reviews.map((r) => (
            <li key={r.id} className="w-[80%] shrink-0 md:w-auto">
              <figure className="flex h-full flex-col rounded-[1.4rem] bg-surface p-5 shadow-[0_1px_2px_rgb(23_10_16/0.05)]">
                <span aria-hidden="true" className="heading-display text-4xl leading-none text-rose-300">“</span>
                <Stars value={r.rating} size={15} />
                {r.text && <blockquote className="mt-2 flex-1 text-[15px] leading-relaxed">{r.text}</blockquote>}
                <figcaption className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                  <span>
                    <b className="block">{r.name}</b>
                    <a href={href(`/produit/${r.productSlug}`)} className="text-xs text-ink-soft hover:text-plum-600">
                      {ar ? r.productAr : r.productFr}
                    </a>
                  </span>
                  {r.verified && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">✓ {R.verified}</span>}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────── Recently viewed (this phone only) ───────── */

export function RecentlyViewed({ products, exclude }: { products: ProductCardDTO[]; exclude?: string }) {
  const { t } = useLocale();
  const recent = useRecent();
  const list = recent
    .filter((s) => s !== exclude)
    .map((s) => products.find((p) => p.slug === s))
    .filter((p): p is ProductCardDTO => !!p)
    .slice(0, 4);
  if (!list.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <SectionHead title={t.home.recent} />
      <ProductGrid products={list} />
    </section>
  );
}
