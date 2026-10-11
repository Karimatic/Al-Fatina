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
 * Both languages as plain text, like luxury fashion shops: « ع | FR ». The current one stands
 * out with a fine rose-gold underline, the other is a quiet link to the same page.
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
    <span dir="ltr" className={`inline-flex h-9 items-center px-1 text-[13px] font-semibold leading-none ${className}`}>
      {options.map((o, i) => {
        const text = o.code === "ar" ? <span className="text-[16px]" style={arabicLetter}>{o.label}</span> : <span className="tracking-[0.18em]">{o.label}</span>;
        return (
          <span key={o.code} className="flex items-center">
            {i > 0 && <span aria-hidden="true" className={`mx-2 h-3.5 w-px rotate-12 ${dark ? "bg-white/30" : "bg-ink-soft/40"}`} />}
            {o.code === locale ? (
              <span aria-current="true" className={`relative grid h-8 place-items-center px-0.5 ${dark ? "text-white" : "text-ink"}`}>
                {text}
                <span aria-hidden="true" className="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full bg-gradient-to-r from-[#e9c98f] via-rose-400 to-plum-600" />
              </span>
            ) : (
              <a
                href={href}
                hrefLang={o.code}
                lang={o.code}
                aria-label={o.name}
                className={`grid h-8 place-items-center px-0.5 transition-colors ${dark ? "text-white/55 hover:text-white" : "text-ink-soft hover:text-ink"}`}
              >
                {text}
              </a>
            )}
          </span>
        );
      })}
    </span>
  );
}
