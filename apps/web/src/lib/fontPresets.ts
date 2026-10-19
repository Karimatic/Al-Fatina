import { designFonts, DEFAULT_FONTS, OWN_FONT, type DesignDTO } from "@elfatina/shared";

/**
 * The design's 4 fonts → CSS variables pointing at the self-hosted families (declared in
 * styles/fonts.css), or at the shop's own uploaded file. A plain module: the theme code only
 * needs these names, not the font loader.
 */
const FAMILY_VAR: Record<string, string> = {
  "Playfair Display": "--font-playfair",
  "DM Sans": "--font-dm-sans",
  Tajawal: "--font-arabic-sans",
  "El Messiri": "--font-arabic-display-face",
  "Cormorant Garamond": "--font-p-cormorant",
  Jost: "--font-p-jost",
  "Noto Kufi Arabic": "--font-p-noto-kufi",
  Amiri: "--font-p-amiri",
  Montserrat: "--font-p-montserrat",
  Inter: "--font-p-inter",
  Cairo: "--font-p-cairo",
  Lora: "--font-p-lora",
  Nunito: "--font-p-nunito",
  Almarai: "--font-p-almarai",
  "Reem Kufi": "--font-p-reem-kufi",
};
/** the uploaded file's family name in the store's CSS */
export const OWN_FONT_FAMILY = "El Fatina Custom";

const face = (name: string, fallback: string) =>
  name === OWN_FONT ? `"${OWN_FONT_FAMILY}", ${fallback}` : FAMILY_VAR[name] ? `var(${FAMILY_VAR[name]}), ${fallback}` : fallback;

/** The CSS variables a design overrides (none with the default fonts). */
export function designFontVars(d: Pick<DesignDTO, "font" | "customFont">): Record<string, string> {
  const f = designFonts(d);
  if (f.display === DEFAULT_FONTS.display && f.sans === DEFAULT_FONTS.sans && f.arabic === DEFAULT_FONTS.arabic && f.arabicDisplay === DEFAULT_FONTS.arabicDisplay) return {};
  return {
    "--font-display": face(f.display, "Georgia, serif"),
    "--font-sans": face(f.sans, "system-ui, sans-serif"),
    "--font-arabic": face(f.arabic, '"Segoe UI", Tahoma, sans-serif'),
    "--font-arabic-display": face(f.arabicDisplay, `${face(f.arabic, "serif")}`),
  };
}

/** @font-face of the shop's own file, when one of the 4 places uses it. */
export function ownFontFace(d: Pick<DesignDTO, "font" | "customFont" | "fontFile">): string {
  if (!d.fontFile) return "";
  const f = designFonts(d);
  if (![f.display, f.sans, f.arabic, f.arabicDisplay].includes(OWN_FONT)) return "";
  const ext = d.fontFile.split(".").pop()?.toLowerCase();
  const format = ext === "woff2" ? "woff2" : ext === "woff" ? "woff" : ext === "otf" ? "opentype" : "truetype";
  return `@font-face{font-family:"${OWN_FONT_FAMILY}";src:url("${d.fontFile}") format("${format}");font-display:swap}`;
}
