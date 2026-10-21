import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toE164, type CategoryDTO, type SiteConfigDTO, mainCategories } from "@elfatina/shared";
import { ChatIcon, HeartIcon, InstagramIcon, MenuIcon, PackageIcon, SearchIcon } from "@/components/ui/icons";
import { useApi } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { useLocaleHref } from "./LanguageSwitch";
import { useDialogFocus } from "@/lib/dialogFocus";

/**
 * The ☰ menu, silk-shop style: the sections as calm capital rows on white (new in, each category,
 * promotions in burgundy), then help on cream and the language. Opens as a panel from the edge its
 * button is on (the start of the header: left in French, right in Arabic). Portalled to <body> so
 * no header style can clip this `position: fixed` overlay.
 */
export function SiteMenu() {
  const { t, href, ar, locale } = useLocale();
  const S = t.silk;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Tab stays inside the open menu (its own code moves the focus in and back)
  useDialogFocus(open, panel);
  const { data: categories } = useApi<CategoryDTO[]>("/categories");
  const site = useApi<SiteConfigDTO>("/site");
  const arHref = useLocaleHref("ar");
  const frHref = useLocaleHref("fr");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  const contact = site.data?.contact;
  const wa = contact?.whatsapp ? toE164(contact.whatsapp)?.replace("+", "") : null;
  const row = "flex min-h-[3.25rem] items-center justify-between border-b border-line px-6 text-[13px] font-medium uppercase tracking-[0.14em] hover:bg-cream";
  const small = "flex min-h-11 items-center gap-3 px-6 text-sm text-ink hover:text-gold";
  const arrow = (
    <span aria-hidden="true" className="text-lg font-light text-ink-soft rtl:rotate-180">
      ›
    </span>
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.nav.menu}
        aria-expanded={open}
        aria-controls="site-menu"
        className="grid size-11 place-items-center text-ink"
      >
        <MenuIcon />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" role="presentation">
            <div className="animate-fade absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
            <div
              id="site-menu"
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label={t.nav.menu}
              tabIndex={-1}
              className="menu-panel absolute inset-y-0 start-0 flex w-[min(22rem,88vw)] flex-col bg-ivory outline-none"
            >
              <div className="flex h-16 items-center justify-between border-b border-line ps-6 pe-2">
                <span className="brand-mark text-base" dir="ltr">
                  Al Fatina
                </span>
                <button type="button" onClick={close} aria-label={t.common.close} className="grid size-11 place-items-center text-3xl font-light text-ink">
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain">
                <nav aria-label={t.nav.shop}>
                  <a href={href("/nouveautes")} className={row}>
                    {S.newIn}
                    {arrow}
                  </a>
                  {mainCategories(categories ?? [])
                    .filter((c) => (c.productCount ?? 0) > 0)
                    .map((c) => (
                      <a key={c.id} href={href(`/c/${c.slug}`)} className={row}>
                        <span className="flex items-baseline gap-2">
                          {ar ? c.nameAr : c.nameFr}
                          <span className="text-[11px] tracking-normal text-ink-soft" dir="ltr">
                            {c.productCount}
                          </span>
                        </span>
                        {arrow}
                      </a>
                    ))}
                  <a href={href("/categories")} className={row}>
                    {t.categories.all}
                    {arrow}
                  </a>
                  <a href={href("/promotions")} className={`${row} text-sale`}>
                    {S.sale}
                    {arrow}
                  </a>
                </nav>

                <nav aria-label={t.nav.help} className="bg-cream py-3">
                  <a href={href("/recherche")} className={small}><SearchIcon size={18} />{t.nav.search}</a>
                  <a href={href("/favoris")} className={small}><HeartIcon size={18} />{t.nav.favorites}</a>
                  <a href={href("/suivi")} className={small}><PackageIcon size={18} />{t.track.cta}</a>
                  <a href={href("/contact")} className={small}><ChatIcon size={18} />{t.contact.title}</a>
                </nav>

                <div className="px-6 py-5">
                  <p className="eyebrow-silk pb-3 text-ink-soft">{t.nav.language}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["ar", "العربية", arHref],
                        ["fr", "Français", frHref],
                      ] as const
                    ).map(([code, label, url]) => (
                      <a
                        key={code}
                        href={url}
                        hrefLang={code}
                        lang={code}
                        aria-current={locale === code ? "true" : undefined}
                        className={`grid h-11 place-items-center rounded-full border text-sm transition ${locale === code ? "border-plum-600 bg-plum-600 text-white" : "border-line text-ink hover:border-ink"}`}
                      >
                        {label}
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {(wa || contact?.instagram) && (
                <div className="flex gap-2 border-t border-line p-4">
                  {contact?.instagram && (
                    <a href={contact.instagram} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-ink text-sm">
                      <InstagramIcon size={18} /> Instagram
                    </a>
                  )}
                  {wa && (
                    <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center rounded-full bg-[#25D366] text-sm font-medium text-[#062a1d]">
                      WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
