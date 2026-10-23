/** Al Fatina's mark: "AF" in Jost, in the text colour (the app icon's letters). */
export function BrandMark({ size = 28, className }: { size?: number; className?: string; light?: boolean }) {
  // the logo (gold calligraphy, transparent), served by the store at /logo.webp; size = its height
  return <img src="/logo.webp" alt="" aria-hidden="true" width={Math.round((size * 446) / 480)} height={size} decoding="async" className={className} />;
}

const SIZES = {
  sm: { text: "text-[0.95rem]", blossom: 36, gap: "gap-1.5", sub: "text-[10px]" },
  md: { text: "text-[1.1rem]", blossom: 46, gap: "gap-2", sub: "text-[11px]" },
  // phones: must fit a ~310 px card (no wrapping, the word is one mark)
  lg: { text: "text-[1.25rem]", blossom: 96, gap: "gap-2.5", sub: "text-[11px] sm:text-xs" },
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
      <BrandMark size={badge ? 40 : s.blossom} className="shrink-0" />
      {!iconOnly && subtitle && (
        <span className={`${s.sub} font-semibold uppercase tracking-[0.22em] text-ink-soft`} aria-hidden="true">
          {subtitle}
        </span>
      )}
    </span>
  );
}
