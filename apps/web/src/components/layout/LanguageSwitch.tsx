import { useEffect, useState } from "react";
import type { Locale } from "@henine/shared";
import { GlobeIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";

/** URL of the current page in the given language (/produit/x ↔ /fr/produit/x), query string kept. */
export function useLocaleHref(target: Locale): string {
  const [href, setHref] = useState(target === "fr" ? "/fr" : "/");
  useEffect(() => {
    const path = location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/";
    setHref((target === "fr" ? (path === "/" ? "/fr" : `/fr${path}`) : path) + location.search);
  }, [target]);
  return href;
}

/** The Arabic letter sits low in its line box: drawn in a system font, nudged up a pixel. */
const arabicLetter = { fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" };

/**
 * A globe, then both languages ("ع | FR") in one rounded box, like the header's other icons:
 * the current language highlighted, the other one a link to the same page in that language.
 */
export function LanguageSwitch({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { locale } = useLocale();
  const other = locale === "ar" ? "fr" : "ar";
  const href = useLocaleHref(other);
  const dark = tone === "dark";
  const box = dark ? "border-white/25 text-white/70" : "border-line text-ink-soft";
  const link = dark ? "hover:text-white" : "hover:text-plum-700";
  const options = [
    { code: "ar" as const, label: "ع", name: "العربية" },
    { code: "fr" as const, label: "FR", name: "Français" },
  ];
  return (
    <span dir="ltr" className={`inline-flex h-9 items-center gap-1 rounded-full border p-0.5 text-[13px] font-semibold leading-none sm:ps-2 ${box} ${className}`}>
      {/* the globe only where there is room: on small phones the shop's name comes first */}
      <GlobeIcon size={15} className="hidden shrink-0 sm:block" />
      {options.map((o, i) => {
        const text = o.code === "ar" ? <span className="-translate-y-px text-[15px]" style={arabicLetter}>{o.label}</span> : <span className="tracking-wider">{o.label}</span>;
        return (
          <span key={o.code} className="flex items-center">
            {i > 0 && <span aria-hidden="true" className={`mx-0.5 h-3.5 w-px ${dark ? "bg-white/25" : "bg-line"}`} />}
            {o.code === locale ? (
              <span aria-current="true" className="grid h-7 min-w-7 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-plum-600 px-1.5 text-white shadow-[0_2px_8px_-2px_rgb(224_72_127/0.6)]">
                {text}
              </span>
            ) : (
              <a href={href} hrefLang={o.code} lang={o.code} aria-label={o.name} className={`grid h-7 min-w-7 place-items-center rounded-full px-1.5 transition-colors ${link}`}>
                {text}
              </a>
            )}
          </span>
        );
      })}
    </span>
  );
}
