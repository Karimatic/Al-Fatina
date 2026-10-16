import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale";
import { consent, CONSENT_OPEN_EVENT, initPixels, pixelsConfigured, setConsent } from "@/lib/pixels";
import { useSite } from "@/lib/site";

/**
 * Starts the shop's ad pixels (Meta, TikTok) and asks the visitor first: a small card at the
 * bottom, only when the shop set up a pixel and she has not answered yet. Fixed position, so
 * nothing on the page moves. « Publicités » in the footer brings it back.
 */
export function AdsConsent() {
  const { t, href } = useLocale();
  const site = useSite();
  const pixels = site.data?.pixels;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!pixels || !pixelsConfigured(pixels)) return;
    initPixels(pixels);
    if (consent() == null) setShow(true);
  }, [pixels?.meta, pixels?.tiktok]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const open = () => setShow(true);
    addEventListener(CONSENT_OPEN_EVENT, open);
    return () => removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  if (!show || !pixelsConfigured(pixels)) return null;
  const answer = (v: "yes" | "no") => {
    setConsent(v);
    setShow(false);
  };
  return (
    <div
      role="region"
      aria-label={t.ads.footer}
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-2xl border border-line bg-surface p-4 text-sm shadow-[0_18px_50px_-12px_rgb(23_10_16/0.4)] md:bottom-4"
    >
      <p>
        {t.ads.text}{" "}
        <a href={href("/p/confidentialite")} className="font-semibold text-plum-700 underline underline-offset-2">
          {t.ads.more}
        </a>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => answer("yes")} className="h-11 flex-1 rounded-full bg-ink px-4 font-semibold text-on-ink">
          {t.ads.yes}
        </button>
        <button type="button" onClick={() => answer("no")} className="h-11 flex-1 rounded-full border border-line px-4 font-semibold">
          {t.ads.no}
        </button>
      </div>
    </div>
  );
}
