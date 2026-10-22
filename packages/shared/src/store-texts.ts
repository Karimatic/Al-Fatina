/**
 * Customer-facing store texts that the team can edit (Admin → Page d'accueil → Textes).
 * Built-in defaults exist for both languages, so nothing ever has to be translated: the
 * admin edits one language at a time, and anything left untouched keeps its default.
 */
import type { Locale } from "./i18n";

export interface StoreTexts {
  /** small line above the big animated title */
  eyebrow: string;
  /** the big animated title at the top of the home page */
  title: string;
  subtitle: string;
  /** messages scrolling in the top banner */
  announcement: string[];
  /** questions at the bottom of the home page */
  faq: { q: string; a: string }[];
  /** shown when orders are paused (Admin → Page d'accueil → pause) */
  pause: string;
}

/** Only the texts the team changed, per language. */
export type StoreTextOverrides = Partial<StoreTexts>;

export const STORE_TEXTS: Record<Locale, StoreTexts> = {
  fr: {
    eyebrow: "La douceur au quotidien",
    title: "Belle, douce, et toujours vous",
    subtitle: "Des pièces tendres et élégantes, choisies pour que vous vous sentiez bien chaque jour, livrées avec soin partout en Algérie.",
    announcement: ["Livraison partout en Algérie, 69 wilayas", "Vous payez à la réception", "Taille pas parfaite ? On l’échange", "Une question ? On vous répond sur WhatsApp"],
    faq: [
      { q: "Vous livrez jusque chez moi ?", a: "Oui, dans les 69 wilayas : à domicile, ou au bureau du transporteur le plus proche si vous préférez." },
      { q: "Je paie quand ?", a: "Seulement quand vous recevez votre colis, en espèces. Aucune carte bancaire." },
      { q: "En combien de temps je la reçois ?", a: "En général 1 à 3 jours dans le Nord, et jusqu’à 7 jours dans le Sud." },
      { q: "Et si la taille ne me va pas ?", a: "Écrivez-nous dans les 48 h après réception : on trouve une solution ensemble." },
      { q: "Le colis est-il discret ?", a: "Toujours : chaque commande part dans un emballage neutre et soigné." },
      { q: "Où en est ma commande ?", a: "Ouvrez « Suivi de commande » avec votre numéro de téléphone : pas de compte, pas de mot de passe." },
    ],
    pause: "Al Fatina fait une petite pause, à très vite.",
  },
  ar: {
    eyebrow: "الرقة في كل يوم",
    title: "جميلة، ناعمة، وعلى طبيعتك دائمًا",
    subtitle: "قطع رقيقة وأنيقة اخترناها لتشعري بالراحة كل يوم، تصلك بعناية إلى كل أنحاء الجزائر.",
    announcement: ["توصيل إلى كل الجزائر، 69 ولاية", "تدفعين عند الاستلام", "المقاس غير مناسب؟ نبدّله لك", "سؤال؟ نجيبك على واتساب"],
    faq: [
      { q: "هل توصلون إلى بيتي؟", a: "نعم، إلى الولايات الـ69: إلى المنزل، أو إلى أقرب مكتب لشركة التوصيل إن فضّلتِ." },
      { q: "متى أدفع؟", a: "عند استلام طردك فقط، نقدًا. لا حاجة لبطاقة بنكية." },
      { q: "في كم يوم يصلني الطلب؟", a: "عادة من 1 إلى 3 أيام في الشمال، وحتى 7 أيام في الجنوب." },
      { q: "وإن لم يناسبني المقاس؟", a: "راسلينا خلال 48 ساعة من الاستلام ونجد الحل معًا." },
      { q: "هل الطرد سري؟", a: "دائمًا: كل طلبية تُرسل في تغليف محايد وأنيق." },
      { q: "أين وصل طلبي؟", a: "افتحي «تتبع الطلب» برقم هاتفك فقط: بدون حساب ولا كلمة سر." },
    ],
    pause: "الفاتنة في استراحة قصيرة، نعود قريبًا.",
  },
};

/** Defaults + the team's edits for one language (empty edits fall back to the default). */
export function resolveStoreTexts(locale: Locale, overrides: StoreTextOverrides | undefined): StoreTexts {
  const d = STORE_TEXTS[locale];
  const o = overrides ?? {};
  const str = (v: string | undefined, fallback: string) => (v && v.trim() ? v : fallback);
  const announcement = o.announcement?.filter((m) => m.trim());
  const faq = o.faq?.filter((f) => f.q.trim() && f.a.trim());
  return {
    eyebrow: str(o.eyebrow, d.eyebrow),
    title: str(o.title, d.title),
    subtitle: str(o.subtitle, d.subtitle),
    announcement: announcement?.length ? announcement : d.announcement,
    faq: faq?.length ? faq : d.faq,
    pause: str(o.pause, d.pause),
  };
}
