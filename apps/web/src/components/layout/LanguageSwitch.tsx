import { useEffect, useState } from "react";
import type { Locale } from "@elfatina/shared";
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
 * A segmented switch « ع | FR »: a rounded track with a fine rose-gold border, the current
 * language in a white pill with a soft shadow, the other one a link to the same page.
 */
export function LanguageSwitch({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { locale } = useLocale();
  const other = locale === "ar" ? "fr" : "ar";
  const href = useLocaleHref(other);
  const dark = tone === "dark";
  const options = [
    { code: "ar" as const, label: "ع", name: "العربية" },
    { code: "fr" as const, label: "FR", name: "Français" },
  ];
  // the two languages as quiet capitals, the current one underlined
  return (
    <span dir="ltr" className={`inline-flex h-9 items-center ${className}`}>
      {options.map((o, i) => {
        const text = o.code === "ar" ? <span className="text-[15px]" style={arabicLetter}>{o.label}</span> : <span className="text-[12px] tracking-[0.14em]">{o.label}</span>;
        const cell = "grid h-full min-w-8 place-items-center px-1.5 font-medium leading-none";
        return (
          <span key={o.code} className="flex h-full items-center">
            {i > 0 && <span aria-hidden="true" className={`h-3.5 w-px ${dark ? "bg-white/30" : "bg-line"}`} />}
            {o.code === locale ? (
              <span aria-current="true" className={`${cell} underline decoration-1 underline-offset-[7px] ${dark ? "text-white" : "text-ink"}`}>
                {text}
              </span>
            ) : (
              <a href={href} hrefLang={o.code} lang={o.code} aria-label={`${o.label} · ${o.name}`} className={`${cell} transition-colors ${dark ? "text-white/60 hover:text-white" : "text-ink-soft hover:text-ink"}`}>
                {text}
              </a>
            )}
          </span>
        );
      })}
    </span>
  );
}
