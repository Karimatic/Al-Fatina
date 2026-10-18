import { useEffect, useRef } from "react";

/**
 * The piece's short video, as one slide of the product gallery: without sound, in a loop, with
 * the phone's own controls. Nothing is downloaded until it is about to be seen (a page with a
 * video costs nothing more to open); it plays while on screen and pauses when swiped away.
 */
export function ProductVideo({ src, poster, label, className = "" }: { src: string; poster?: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          if (v.preload === "none") v.preload = "auto";
          void v.play().catch(() => undefined); // a phone in power saving may refuse: the controls stay
        } else v.pause();
      },
      { threshold: [0, 0.6] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [src]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      controls
      preload="none"
      aria-label={label}
      className={`bg-ink object-cover ${className}`}
    />
  );
}
