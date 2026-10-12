/**
 * Endless decorative animations (home banner, announcement bar) stop while they are scrolled
 * out of view: the phone then spends nothing on them while scrolling the rest of the page. Sets
 * data-paused on the element; the CSS pauses it and everything inside. A callback ref, so it
 * also works for an element that appears later (after the page's data has loaded).
 */
import { useCallback, useRef } from "react";

export function usePauseOffscreen<T extends HTMLElement>() {
  const io = useRef<IntersectionObserver | null>(null);
  return useCallback((el: T | null) => {
    io.current?.disconnect();
    io.current = null;
    if (!el || typeof IntersectionObserver === "undefined") return;
    io.current = new IntersectionObserver(([e]) => el.toggleAttribute("data-paused", !e!.isIntersecting), { rootMargin: "80px" });
    io.current.observe(el);
  }, []);
}
