import { useEffect, useState } from "react";
import type { SiteConfigDTO } from "@elfatina/shared";
import { useApi } from "@/lib/api";
import { useStoreTexts } from "@/lib/storeTexts";
import { usePauseOffscreen } from "@/lib/pauseOffscreen";

/**
 * Top banner: a slowly flowing rose gradient with the messages. How they move is chosen in
 * Admin → Page d'accueil → Textes: scrolling endlessly (marquee, pauses on hover), one at a
 * time fading or sliding up, or still. Static when the visitor prefers reduced motion.
 * Messages: built in for each language, editable in Admin → Page d'accueil → Textes.
 *
 * The pages are built in advance, without the shop's settings: until they arrive, the bar shows
 * the movement remembered from the visitor's last page (else the first message, still), never
 * a default that then switches (a scrolling bar turning into "one at a time" on every page).
 */
const REMEMBER = "elfatina.announce";

export function AnnouncementBar() {
  const { data } = useApi<SiteConfigDTO>("/site");
  const messages = useStoreTexts().announcement; // built-in or edited in the admin, in the language of the page
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    try {
      setRemembered(localStorage.getItem(REMEMBER));
    } catch {
      /* private mode: the still first message until the settings arrive */
    }
  }, []);
  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(REMEMBER, data.announcement.active ? data.announcement.animation : "off");
    } catch {
      /* private mode */
    }
  }, [data]);
  const animation = data?.announcement.animation ?? remembered ?? "waiting";
  const ref = usePauseOffscreen<HTMLDivElement>();
  if (data ? !data.announcement.active : remembered === "off") return null;
  if (animation === "waiting") {
    return (
      <div ref={ref} className="announce overflow-hidden text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
        <p aria-hidden="true" className="truncate px-4 py-2 text-center">
          {messages[0]}
        </p>
      </div>
    );
  }
  if (animation === "fade" || animation === "slide") return <OneAtATime messages={messages} slide={animation === "slide"} />;
  if (animation === "static") {
    return (
      <div ref={ref} className="announce overflow-hidden px-4 py-2 text-center text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
        <p className="truncate">{messages.join("  ✦  ")}</p>
      </div>
    );
  }
  // repeat so one copy is always wider than the screen, then double it for the seamless loop
  const lane = Array.from({ length: Math.max(2, Math.ceil(8 / messages.length)) }, () => messages).flat();

  return (
    <div ref={ref} className="announce overflow-hidden text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
      <div className="announce-track py-2" aria-hidden="true">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0">
            {lane.map((m, i) => (
              <li key={`${copy}-${i}`} className="flex shrink-0 items-center whitespace-nowrap">
                <span className="px-5">{m}</span>
                <span className="announce-sparkle text-[9px] text-gold" style={{ animationDelay: `${(i % 4) * 0.5}s` }}>
                  ✦
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

/** One message at a time, changing every few seconds (fading, or sliding up). */
function OneAtATime({ messages, slide }: { messages: string[]; slide: boolean }) {
  const [i, setI] = useState(0);
  // the first message is already on screen (still, while the page loaded): it doesn't animate in
  const [moved, setMoved] = useState(false);
  const ref = usePauseOffscreen<HTMLDivElement>();
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => {
      setMoved(true);
      setI((n) => (n + 1) % messages.length);
    }, 3800);
    return () => clearInterval(t);
  }, [messages.length]);
  return (
    <div ref={ref} className="announce overflow-hidden text-[13px] font-medium text-white" role="region" aria-label={messages.join(" · ")}>
      <p key={i} aria-hidden="true" className={`truncate px-4 py-2 text-center ${!moved ? "" : slide ? "announce-slide" : "announce-fade"}`}>
        {messages[i % messages.length]}
      </p>
    </div>
  );
}
