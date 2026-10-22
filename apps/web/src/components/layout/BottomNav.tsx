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
  // a floating dock: a frosted capsule above the bottom edge; the page you are on opens into a
  // gradient pill with its name, the others are icons alone (their names are read aloud)
  return (
    <nav
      aria-label="Navigation"
      className={`fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-40 rounded-full bg-white/90 p-1.5 shadow-[0_14px_36px_-12px_rgb(110_58_166/0.45)] ring-1 ring-line backdrop-blur-md transition-transform duration-300 md:hidden ${hidden ? "translate-y-[150%]" : ""}`}
    >
      <ul className="flex items-center justify-between">
        {items.map(({ to, label, Icon, match }) => {
          const active = path !== "" && match(path);
          return (
            <li key={to} className={active ? "min-w-0 flex-[1.6]" : "flex-1"}>
              <a
                href={href(to)}
                aria-current={active ? "page" : undefined}
                aria-label={active ? undefined : label}
                className={`relative mx-auto flex h-12 items-center justify-center gap-1.5 rounded-full transition-all duration-300 ${active ? "bg-plum-600 px-3.5 text-white" : "w-12 text-ink-soft hover:text-ink"}`}
              >
                <Icon size={20} />
                {active && <span className="truncate text-[12.5px] font-medium">{label}</span>}
                {label === t.nav.trackShort && order && (
                  <span className="absolute end-2 top-2 size-2.5 rounded-full bg-sale ring-2 ring-white" aria-label={t.status[order.status]} />
                )}
                {to === "/panier" && count > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-sale px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white">
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
