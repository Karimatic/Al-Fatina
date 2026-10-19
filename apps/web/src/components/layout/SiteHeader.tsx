import { useEffect, useState } from "react";
import { mainCategories, type CategoryDTO } from "@elfatina/shared";
import { BagIcon, HeartIcon, SearchIcon } from "@/components/ui/icons";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useDesign } from "@/lib/site";
import { cartCount, useCart, useFavorites } from "@/lib/stores";
import { LanguageSwitch } from "./LanguageSwitch";
import { SiteMenu } from "./SiteMenu";

/**
 * Silk-shop header: a thin dark Al Fatina Club line, then the bar.
 * Computers: AL FATINA on the left, the sections in spaced capitals, search · language · favourites
 * · bag on the right. Phones: ☰ and search at the start, the name in the middle, the bag at the end.
 * Only the bar stays at the top while scrolling.
 */
export function SiteHeader() {
  const { t, href } = useLocale();
  const items = useCart();
  const favs = useFavorites();
  const count = cartCount(items);
  const logo = useDesign().logo;
  const icon = "relative grid size-11 place-items-center text-ink transition hover:text-gold";

  return (
    <>
      <p className="bg-ink px-4 py-2 text-center text-[11.5px] tracking-[0.08em] text-white/90">
        <span aria-hidden="true" className="me-2 text-gold">
          ✦
        </span>
        {t.silk.club}
      </p>
      <header className="sticky top-0 z-40 border-b border-line bg-ivory">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-2 md:h-[4.75rem] md:px-6">
          {/* start: ☰ (everywhere: help, language, every link) + search on phones and tablets */}
          <div className="flex flex-1 items-center lg:flex-none">
            <SiteMenu />
            <a href={href("/recherche")} className={`${icon} lg:hidden`} aria-label={t.nav.search}>
              <SearchIcon />
            </a>
          </div>

          <a href={href("/")} className="flex shrink-0 items-center py-2 lg:me-6 lg:ms-2" aria-label="Al Fatina">
            {logo ? (
              // the shop's own logo (Admin → Page d'accueil → Apparence)
              <img src={logo} alt="Al Fatina" className="h-8 w-auto max-w-[10rem] object-contain md:h-10" />
            ) : (
              <span className="brand-mark whitespace-nowrap text-[1.05rem] min-[400px]:text-[1.2rem] md:text-[1.5rem]" dir="ltr">
                Al Fatina
              </span>
            )}
          </a>

          {/* computers: the sections in the bar itself */}
          <SectionNav className="hidden min-w-0 flex-1 lg:block" />

          <div className="flex flex-1 items-center justify-end lg:flex-none">
            <a href={href("/recherche")} className={`${icon} max-lg:hidden`} aria-label={t.nav.search}>
              <SearchIcon />
            </a>
            <LanguageSwitch className="mx-1 max-sm:hidden" />
            <a href={href("/favoris")} className={`${icon} max-sm:hidden`} aria-label={t.nav.favorites}>
              <HeartIcon />
              {favs.length > 0 && <span className="absolute end-2 top-2 size-2 rounded-full bg-sale" />}
            </a>
            <a href={href("/panier")} className={icon} aria-label={`${t.nav.cart} (${count})`}>
              <BagIcon />
              {count > 0 && (
                <span className="absolute end-0.5 top-1 grid size-5 place-items-center rounded-full bg-ink text-[10.5px] font-medium text-white" dir="ltr">
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </a>
          </div>
        </div>
        {/* phones and tablets: the sections as a row under the bar */}
        <SectionNav className="border-t border-line lg:hidden" />
      </header>
    </>
  );
}

/**
 * The sections: new in, the shop's categories (those with pieces), promotions in burgundy, order
 * tracking. Spaced capitals with a thin line under the page you are on; the row scrolls sideways
 * when it does not fit.
 */
function SectionNav({ className = "" }: { className?: string }) {
  const { t, href, ar } = useLocale();
  const { data: categories } = useApi<CategoryDTO[]>("/categories");
  const [path, setPath] = useState("");
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);
  const cats = mainCategories(categories ?? []).filter((c) => (c.productCount ?? 0) > 0);
  const items: { to: string; label: string; sale?: boolean }[] = [
    { to: "/nouveautes", label: t.silk.newIn },
    ...cats.map((c) => ({ to: `/c/${c.slug}`, label: ar ? c.nameAr : c.nameFr })),
    { to: "/promotions", label: t.silk.sale, sale: true },
    { to: "/suivi", label: t.silk.track },
  ];
  return (
    <nav aria-label={t.nav.shop} className={`swipe-row overflow-x-auto ${className}`}>
      {/* w-max + mx-auto: centred when it fits, scrolls from its first item when it does not */}
      <ul className="mx-auto flex h-11 w-max items-stretch gap-1 px-2 lg:h-[4.75rem] lg:gap-0.5">
        {items.map(({ to, label, sale }) => {
          const on = path !== "" && (path === to || path.startsWith(`${to}/`));
          return (
            <li key={to} className="flex shrink-0">
              <a
                href={href(to)}
                aria-current={on ? "page" : undefined}
                className={`flex items-center border-b px-3 text-[12px] font-medium uppercase tracking-[0.14em] transition ${on ? "border-ink" : "border-transparent hover:border-ink/30"} ${sale ? "text-sale" : "text-ink"}`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
