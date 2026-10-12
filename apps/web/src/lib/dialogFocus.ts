/**
 * Keyboard and screen-reader behaviour shared by every pop-up panel of the store (WAI-ARIA modal
 * dialog): when it opens, focus moves into it; Tab / Shift+Tab stay inside; when it closes,
 * focus goes back to what opened it. Put the returned ref on the element with role="dialog".
 *
 * First focus: the element marked `data-autofocus` on a computer (a search field…), else the
 * panel itself, so a phone's keyboard never jumps up before the customer asks for it. Each
 * panel keeps its own Escape / outside-tap handling. `open`: for a panel that stays mounted and
 * only shows when opened; `existing`: a ref the component already has on its dialog.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus<T extends HTMLElement>(open = true, existing?: RefObject<T | null>) {
  const own = useRef<T>(null);
  const ref = existing ?? own;
  useEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));

    if (!box.contains(document.activeElement)) {
      const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
      const preferred = fine ? box.querySelector<HTMLElement>("[data-autofocus]") : null;
      if (preferred) preferred.focus({ preventScroll: true });
      else {
        if (!box.hasAttribute("tabindex")) box.tabIndex = -1;
        box.focus({ preventScroll: true });
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      const outside = !box.contains(active);
      if (e.shiftKey && (active === first || active === box || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // back to the button that opened it (if it is still on the page)
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref as RefObject<T>;
}
