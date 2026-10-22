import { useEffect, useRef, useState, type ReactNode } from "react";
import { InstagramIcon } from "@/components/ui/icons";
import { useLocale } from "@/lib/locale";
import { useSite } from "@/lib/site";
import { useStoreTexts } from "@/lib/storeTexts";

/** Fades/slides its children in when they scroll into view (once). */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setVisible(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        // also reveal sections already scrolled past (e.g. after jumping to an anchor)
        if (entry && (entry.isIntersecting || entry.boundingClientRect.top < 0)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Section heading: title on the start side, "see all" on the end side. */
export function SectionHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-8 text-center md:mb-11">
      <span aria-hidden="true" className="mb-2 block text-sm text-plum-600">
        ✦
      </span>
      <h2 className="title-silk text-[2rem] text-ink md:text-[2.75rem]">{title}</h2>
      {href && link && (
        <a href={href} className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-4 py-1.5 text-[12.5px] text-plum-700 ring-1 ring-line transition hover:ring-plum-600/50">
          {link}
          <span aria-hidden="true" className="rtl:rotate-180">→</span>
        </a>
      )}
    </div>
  );
}

/* ───────── Instagram: the big detailed card ───────── */

/**
 * The Instagram block, Al Fatina style: no card, a calm centred moment on the wash: the account
 * name large in the brand gradient, one line, the follow pill, the figures as quiet text; the
 * shop's photos under it when there are some.
 */
export function InstagramCard({ children }: { children?: React.ReactNode }) {
  const { t } = useLocale();
  const contact = useSite().data?.contact;
  const href = contact?.instagram || "https://www.instagram.com/el_fatina_/";
  const stats: [string, string][] = [...(contact?.followers ? [[contact.followers, t.instagram.followers] as [string, string]] : []), ...t.instagram.stats];
  return (
    <section className="wash">
      <div className="mx-auto max-w-4xl px-5 py-16 text-center md:py-24">
        <Reveal>
          <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-full bg-plum-600 text-white shadow-[0_14px_30px_-12px_rgb(158_58_146/0.8)]">
            <InstagramIcon size={26} />
          </span>
          <p className="eyebrow-silk mt-5 text-plum-700">{t.instagram.label}</p>
          <a href={href} target="_blank" rel="noopener noreferrer" className="title-silk text-grad mt-2 inline-block text-[2.4rem] md:text-[3.6rem]" dir="ltr">
            @el_fatina_
          </a>
          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">{t.instagram.text}</p>
          <p className="mt-4 text-[13px] text-ink-soft">
            {stats.map(([value, label], i) => (
              <span key={label}>
                {i > 0 && <span aria-hidden="true" className="mx-2 text-plum-600">✦</span>}
                <b className="font-medium text-ink" dir="ltr">{value}</b> {label}
              </span>
            ))}
          </p>
          <a href={href} target="_blank" rel="noopener noreferrer" className="btn-silk mt-7">
            <InstagramIcon size={17} />
            <span dir="ltr">{t.instagram.cta}</span>
          </a>
        </Reveal>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}

/* ───────── FAQ ───────── */

/**
 * Questions, Al Fatina style: two columns on computers: the title and a « write to us » card on
 * the start side, the questions as separate soft cards on the other (one under the other on
 * phones). Built in, or edited in Admin → Paramètres → Textes.
 */
export function Faq() {
  const { t, href } = useLocale();
  const list = useStoreTexts().faq;
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24" aria-labelledby="faq-title">
      <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-14">
        <div className="text-center md:sticky md:top-28 md:self-start md:text-start">
          <span aria-hidden="true" className="text-sm text-plum-600">
            ✦
          </span>
          <h2 id="faq-title" className="title-silk mt-2 text-[2.1rem] text-ink md:text-[2.9rem]">
            {t.faq.title}
          </h2>
          <div className="wash mt-6 rounded-3xl p-6 text-center shadow-soft md:text-start">
            <p className="text-[15px] text-ink">{t.faq.helpTitle}</p>
            <a href={href("/contact")} className="btn-silk mt-4">
              {t.faq.helpCta}
            </a>
          </div>
        </div>
        <div className="space-y-3">
          {list.map((f) => (
            <details key={f.q} className="faq-item group rounded-2xl bg-white shadow-soft ring-1 ring-line transition open:ring-plum-600/30">
              <summary className="flex cursor-pointer items-center gap-4 px-5 py-4 md:px-6 md:py-5">
                <span className="flex-1 text-[15px] font-medium text-ink">{f.q}</span>
                <span className="faq-plus grid size-8 shrink-0 place-items-center rounded-full bg-plum-600 text-lg leading-none text-white" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 text-[14.5px] leading-relaxed text-ink-soft md:px-6">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
