import { useEffect, useState } from "react";
import type { Locale } from "@henine/shared";
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
  return (
    // the gradient is the border: a 1.5 px frame around the track
    <span dir="ltr" className={`inline-flex rounded-full bg-gradient-to-r from-[#e9c98f] via-rose-300 to-plum-600 p-[1.5px] ${className}`}>
      <span className={`relative grid h-[34px] grid-cols-2 items-center rounded-full p-[3px] ${dark ? "bg-noir" : "bg-surface"}`}>
        {/* the white pill under the current language */}
        <span
          aria-hidden="true"
          className={`absolute inset-y-[3px] w-[calc(50%-3px)] rounded-full bg-white shadow-[0_2px_8px_-1px_rgb(106_12_54/0.35)] ring-1 ring-rose-200 transition-transform duration-300 ${
            locale === "ar" ? "left-[3px]" : "left-[3px] translate-x-full"
          }`}
        />
        {options.map((o) => {
          const text = o.code === "ar" ? <span className="-translate-y-px text-[15px]" style={arabicLetter}>{o.label}</span> : <span className="text-[12px] tracking-[0.12em]">{o.label}</span>;
          const cell = "relative z-10 grid h-full min-w-[34px] place-items-center px-2 font-bold leading-none";
          return o.code === locale ? (
            <span key={o.code} aria-current="true" className={`${cell} text-[#6a0c36]`}>
              {text}
            </span>
          ) : (
            <a key={o.code} href={href} hrefLang={o.code} lang={o.code} aria-label={`${o.label} · ${o.name}`} className={`${cell} transition-colors ${dark ? "text-white/60 hover:text-white" : "text-ink-soft hover:text-plum-700"}`}>
              {text}
            </a>
          );
        })}
      </span>
    </span>
  );
}
