/**
 * The brand promise, animated with pure CSS (no JS, works before hydration):
 * each word rises into place one after another, then a golden light travels through the
 * letters on a slow loop. Respects prefers-reduced-motion (see globals.css).
 */
export function AnimatedTagline({
  text,
  as: Tag = "h1",
  tone = "dark",
  variant = "words",
  className = "",
}: {
  text: string;
  as?: "h1" | "p";
  tone?: "dark" | "light";
  /** "cinema" (home banner): the whole line opens from the centre like a curtain, a gold line draws under it, a slow glint passes */
  variant?: "words" | "cinema";
  className?: string;
}) {
  if (variant === "cinema")
    return (
      <Tag className={`tagline-cinema heading-display ${className}`} aria-label={text}>
        <span aria-hidden="true" className="tagline-cinema-text">
          {text}
        </span>
        <span aria-hidden="true" className="tagline-cinema-line" />
      </Tag>
    );
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className={`tagline heading-display ${tone === "light" ? "tagline-light" : ""} ${className}`} aria-label={text}>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <span key={`${w}-${i}`} className="tagline-word" style={{ animationDelay: `${120 + i * 110}ms, ${1900 + i * 160}ms` }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </Tag>
  );
}
