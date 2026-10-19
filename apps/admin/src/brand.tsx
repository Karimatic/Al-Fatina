/** Al Fatina's mark: "AF" in Jost, in the text colour (the app icon's letters). */
export function BrandMark({ size = 28, className, light = false }: { size?: number; className?: string; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path fill={light ? "#ffffff" : "currentColor"} d="M18.43 37.50L28.28 37.50L31.39 44.84L34.71 44.84L23.35 19.16L12 44.84L15.32 44.84L18.43 37.50ZM19.62 34.71L23.35 25.90L27.09 34.71L19.62 34.71ZM52 20.38L39.42 20.38L39.42 44.84L42.39 44.84L42.39 32.96L51.65 32.96L51.65 30.17L42.39 30.17L42.39 23.18L52 23.18L52 20.38Z" />
    </svg>
  );
}

const SIZES = {
  sm: { text: "text-xl", blossom: 24, gap: "gap-1.5", sub: "text-[10px]" },
  md: { text: "text-[1.4rem]", blossom: 30, gap: "gap-2", sub: "text-[11px]" },
  // phones: must fit a ~310 px card (no wrapping, the word is one mark)
  lg: { text: "text-[1.7rem] min-[400px]:text-3xl sm:text-[2.6rem]", blossom: 38, gap: "gap-2.5", sub: "text-[11px] sm:text-xs" },
} as const;

export function Wordmark({
  size = "md",
  subtitle,
  iconOnly = false,
  badge = false,
  className = "",
}: {
  size?: keyof typeof SIZES;
  subtitle?: string;
  iconOnly?: boolean;
  /** blossom inside a round brand badge (sidebar header, like the template's logo) */
  badge?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={`relative inline-flex items-center ${s.gap} ${className}`} aria-label="Al Fatina">
      {badge ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-500 via-plum-600 to-plum-700 shadow-[0_2px_8px_-2px_rgb(157_23_77/0.5)]">
          <BrandMark size={22} light className="wordmark-blossom" />
        </span>
      ) : (
        <BrandMark size={s.blossom} className="wordmark-blossom shrink-0" />
      )}
      {!iconOnly && (
        <span className="relative flex min-w-0 flex-col" aria-hidden="true">
          <span className={`wordmark whitespace-nowrap ${s.text}`} dir="ltr">
            Al Fatina
          </span>
          {subtitle && <span className={`${s.sub} font-semibold uppercase tracking-[0.22em] text-ink-soft`}>{subtitle}</span>}
          {/* twinkles just past the end of the word, never over the letters */}
          <span className="wordmark-sparkle -end-3 -top-1.5 text-[10px]" style={{ animationDelay: "1.4s" }}>
            ✦
          </span>
          <span className="wordmark-sparkle -end-4.5 top-[38%] text-[7px]" style={{ animationDelay: "2.6s" }}>
            ✦
          </span>
        </span>
      )}
    </span>
  );
}
