import { isNewArrival, type ProductCardDTO } from "@elfatina/shared";
import { useLocale } from "@/lib/locale";

// quiet tags: charcoal for what sells, white for the rest
const TONE: Record<string, string> = {
  bestseller: "bg-plum-600 text-white",
  trending: "bg-plum-600 text-white",
  popular: "bg-white text-ink",
  new: "bg-white text-ink",
  pick: "bg-white text-ink",
};

/**
 * At most two badges, all backed by data: sales badges come from real orders (see
 * BADGE_RULES), "new" from the publication date, "coup de cœur" is the team's own pick.
 */
export function productBadges(p: Pick<ProductCardDTO, "badge" | "createdAt" | "tags">): string[] {
  const out: string[] = [];
  if (p.badge) out.push(p.badge);
  if (isNewArrival(p.createdAt) || p.tags.includes("nouveaute")) out.push("new");
  if (p.tags.includes("best-seller")) out.push("pick");
  return out.slice(0, 2);
}

export function Badges({ p, className = "" }: { p: Pick<ProductCardDTO, "badge" | "createdAt" | "tags">; className?: string }) {
  const { t } = useLocale();
  const list = productBadges(p);
  if (!list.length) return null;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {list.map((b) => (
        <span key={b} className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] shadow-sm ${TONE[b]}`}>
          {t.badges[b]}
        </span>
      ))}
    </span>
  );
}
