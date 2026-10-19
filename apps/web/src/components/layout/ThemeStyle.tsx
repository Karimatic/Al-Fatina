import { useEffect } from "react";
import { DEFAULT_DESIGN, productBgVars, themeVars } from "@elfatina/shared";
import { designFontVars, ownFontFace } from "@/lib/fontPresets";
import { DESIGN_KEY as KEY } from "@/lib/boot";
import { useDesign } from "@/lib/site";

const rules = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");

/**
 * Colours and fonts chosen in Admin → Page d'accueil → Apparence, as a small stylesheet
 * (the store is light only). Remembered on the phone so the next page
 * paints with them straight away (see THEME_BOOT).
 */
export function ThemeStyle() {
  const design = useDesign();
  const { accent, soft } = design.colors;
  const font = design.font;
  const customFont = design.customFont;
  const fontFile = design.fontFile;
  const productBg = design.productBg;
  const fontKey = JSON.stringify([font, customFont, fontFile]);
  useEffect(() => {
    const isDefault = accent.toLowerCase() === DEFAULT_DESIGN.colors.accent && soft.toLowerCase() === DEFAULT_DESIGN.colors.soft;
    const fonts = designFontVars({ font, customFont });
    let css = ownFontFace({ font, customFont, fontFile }) + (Object.keys(fonts).length ? `:root:root{${rules(fonts)}}` : "");
    if (!isDefault) css += `:root:root{${rules(themeVars({ accent, soft }))}}`;
    // background behind product pictures (Apparence → Fond des produits)
    const tile = productBgVars(productBg, false);
    if (Object.keys(tile).length) css += `:root:root{${rules(tile)}}`;
    let style = document.getElementById("elfatina-theme");
    if (css) {
      if (!style) {
        style = Object.assign(document.createElement("style"), { id: "elfatina-theme" });
        document.head.appendChild(style);
      }
      if (style.textContent !== css) style.textContent = css;
    } else style?.remove();
    try {
      localStorage.setItem(KEY, JSON.stringify({ css }));
      localStorage.removeItem("elfatina.design.v1");
      localStorage.removeItem("elfatina.design.v2"); // older format with a Google Fonts link
    } catch {
      /* private mode */
    }
  }, [accent, soft, fontKey, productBg]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
