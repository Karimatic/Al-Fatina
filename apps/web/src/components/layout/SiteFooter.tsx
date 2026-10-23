import { useLocale } from "@/lib/locale";
import { InstagramIcon } from "@/components/ui/icons";
import { WhatsAppIcon } from "./FloatingHelp";
import { useDesign, useSite, whatsappLink } from "@/lib/site";
import { LanguageSwitch } from "./LanguageSwitch";
import { openConsent, pixelsConfigured } from "@/lib/pixels";

/** Social links saved in Admin → Contact (only the ones filled in). */
function useSocials() {
  const { t } = useLocale();
  const c = useSite().data?.contact;
  const instagram = c?.instagram ?? "https://www.instagram.com/el_fatina_/";
  return [
    { key: "instagram", href: instagram, label: "Instagram", icon: <InstagramIcon size={17} /> },
    { key: "whatsapp", href: whatsappLink(c?.whatsapp, t.plus.whatsapp.hello), label: "WhatsApp", icon: <WhatsAppIcon size={17} /> },
    { key: "tiktok", href: c?.tiktok, label: "TikTok", icon: <span aria-hidden="true" className="text-sm font-black">♪</span> },
    { key: "facebook", href: c?.facebook, label: "Facebook", icon: <span aria-hidden="true" className="text-sm font-black">f</span> },
  ].filter((s): s is typeof s & { href: string } => !!s.href);
}

/**
 * Silk-shop footer on cream: link columns under spaced capital titles (the house, help, the shop),
 * the Al Fatina Club and the social buttons; then a thin line with the year, the ads choice and
 * the language.
 */
export function SiteFooter() {
  const site = useSite();
  const { t, href, ar } = useLocale();
  const design = useDesign();
  const socials = useSocials();
  const note = ar ? design.footerAr || design.footerFr : design.footerFr || design.footerAr;
  const page = (slug: string, fr: string, arLabel: string): [string, string] => [href(`/p/${slug}`), ar ? arLabel : fr];
  const columns: { title: string; links: [string, string][] }[] = [
    {
      title: ar ? "عن الفاتنة" : "À propos",
      links: [page("a-propos", "Notre histoire", "قصتنا"), page("cgv", "Conditions de vente", "شروط البيع"), page("confidentialite", "Confidentialité", "الخصوصية"), [href("/liens"), t.footer.links]],
    },
    {
      title: t.nav.help,
      links: [[href("/suivi"), t.track.cta], page("livraison-retours", "Livraison & retours", "التوصيل والإرجاع"), [href("/contact"), t.footer.contact]],
    },
    {
      title: t.nav.shop,
      links: [
        [href("/nouveautes"), t.silk.newIn],
        [href("/categories"), t.categories.all],
        [href("/promotions"), t.silk.sale],
        [href("/favoris"), t.nav.favorites],
        [href("/tenue"), t.plus.outfit.link],
      ],
    },
  ];
  const title = "eyebrow-silk mb-4 text-ink";
  return (
    <footer className="wash mt-16 rounded-t-[2.5rem]">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 sm:grid-cols-2 md:py-16 lg:grid-cols-4 lg:px-8">
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className={title}>{col.title}</p>
            <ul className="space-y-3 text-sm text-ink-soft">
              {col.links.map(([to, label]) => (
                <li key={to}>
                  <a href={to} className="transition hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <div>
          <p className={title}>{t.plus.footerFollow}</p>
          <div className="flex flex-wrap gap-2">
            {socials.map((s) => (
              <a key={s.key} href={s.href} rel="noopener noreferrer" target="_blank" aria-label={s.label} className="grid size-10 place-items-center rounded-full border border-ink/25 text-ink transition hover:border-ink hover:bg-plum-600 hover:text-white">
                {s.icon}
              </a>
            ))}
          </div>
          <p className="mt-6 text-sm leading-relaxed text-ink-soft">
            <span aria-hidden="true" className="me-1.5 text-gold">
              ✦
            </span>
            {t.silk.club}
          </p>
          {note && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{note}</p>}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-5 pb-20 md:pb-5 lg:px-8">
          {design.logo ? (
            <img src={design.logo} alt="Al Fatina" className="h-8 w-auto max-w-[9rem] object-contain" />
          ) : (
            <img src="/logo.webp" alt="Al Fatina" width={89} height={96} loading="lazy" className="h-24 w-auto" />
          )}
          <p className="text-xs text-ink-soft">
            © {new Date().getFullYear()} Al Fatina · {t.footer.rights}
            {pixelsConfigured(site.data?.pixels) && (
              <>
                {" · "}
                <button type="button" onClick={openConsent} className="underline underline-offset-2 hover:text-ink">
                  {t.ads.footer}
                </button>
              </>
            )}
          </p>
          <LanguageSwitch />
        </div>
      </div>
    </footer>
  );
}
