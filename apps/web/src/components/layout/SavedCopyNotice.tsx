import { useEffect, useState } from "react";
import { SAVED_COPY_EVENT, savedCopyShown } from "@/lib/api";
import { useLocale } from "@/lib/locale";

/**
 * Prices or stock on this page came from the phone's saved copy (the shop didn't answer in
 * time): a small notice says they may have changed, with « Refresh ». The order itself is
 * always priced again by the shop.
 */
export function SavedCopyNotice() {
  const { t } = useLocale();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (savedCopyShown) setShow(true);
    const on = () => setShow(true);
    window.addEventListener(SAVED_COPY_EVENT, on);
    return () => window.removeEventListener(SAVED_COPY_EVENT, on);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-on-ink shadow-lg md:bottom-4">
      <span className="flex-1">{t.common.savedCopy}</span>
      <button type="button" onClick={() => location.reload()} className="h-10 shrink-0 rounded-full bg-on-ink/15 px-4 font-semibold">
        {t.common.refresh}
      </button>
    </div>
  );
}
