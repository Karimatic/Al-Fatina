import { useEffect, useState } from "react";
import { BagIcon, GridIcon, HeartIcon, HomeIcon, PackageIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
import { useActiveOrder } from "@/lib/activeOrder";
import { cartCount, useCart } from "@/lib/stores";

/** Mobile thumb-zone navigation. Hidden from md up. */
export function BottomNav() {
  const { t, href } = useLocale();
  const count = cartCount(useCart());
  const order = useActiveOrder();
  const [path, setPath] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => setPath(location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/"), []);
  // tucked away while scrolling down (more room for the page), back when scrolling up,
  // near the top or at the end of the page
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    // at most once per frame (a phone fires several scroll events per frame)
    const check = () => {
      frame = 0;
      const y = window.scrollY;
      const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
      if (y < 80 || atEnd || y < last - 8) setHidden(false);
      else if (y > last + 8) setHidden(true);
      if (Math.abs(y - last) > 8) last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    if (hidden) document.documentElement.dataset.nav = "hidden";
    else delete document.documentElement.dataset.nav;
  }, [hidden]);

  const items = [
    { to: "/", label: t.nav.home, Icon: HomeIcon, match: (p: string) => p === "/" },
    { to: "/categories", label: t.nav.categories, Icon: GridIcon, match: (p: string) => p.startsWith("/categories") || p.startsWith("/c/") },
    // an order on its way: the tab opens it directly and shows a dot
    { to: order ? order.link : "/suivi", label: t.nav.trackShort, Icon: PackageIcon, match: (p: string) => p.startsWith("/suivi") },
    { to: "/favoris", label: t.nav.favorites, Icon: HeartIcon, match: (p: string) => p.startsWith("/favoris") },
    { to: "/panier", label: t.nav.cart, Icon: BagIcon, match: (p: string) => p.startsWith("/panier") || p.startsWith("/commande") },
  ];
  return (
    <nav
      aria-label="Navigation"
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] transition-transform duration-300 md:hidden ${hidden ? "translate-y-full" : ""}`}
    >
      <ul className="grid grid-cols-5">
        {items.map(({ to, label, Icon, match }) => {
          const active = path !== "" && match(path);
          return (
            <li key={to}>
              <a
                href={href(to)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-[0.08em] transition ${active ? "font-medium text-ink" : "text-ink-soft"}`}
              >
                {/* the page you are on: a thin line along the top of its tab */}
                {active && <span aria-hidden="true" className="absolute inset-x-4 top-0 h-px bg-plum-600" />}
                <span className="grid h-7 place-items-center">
                  <Icon size={20} />
                </span>
                <span className="max-w-full truncate px-0.5">{label}</span>
                {label === t.nav.trackShort && order && (
                  <span className="absolute top-1.5 size-2.5 rounded-full bg-sale ring-2 ring-white ms-7" aria-label={t.status[order.status]} />
                )}
                {to === "/panier" && count > 0 && (
                  <span className="absolute top-1 grid min-w-5 place-items-center rounded-full bg-plum-600 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white ms-8">
                    {count}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
