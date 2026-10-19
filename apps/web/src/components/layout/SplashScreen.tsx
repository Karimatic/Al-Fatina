import { BrandMark } from "@/components/ui/icons";

/**
 * Brand intro screen, only when the shop is opened as an installed app (in a browser it delayed
 * the first view of every visit, an ad click included), once per launch, for ~1 second before it
 * fades out. The markup is server-rendered so it is already visible in the very first paint,
 * and the whole 1s-hold-then-fade timing is a single CSS animation (`elfatina-splash-cycle`,
 * see globals.css) — not a JS setTimeout. CSS animations of opacity run on the compositor
 * and start the instant the stylesheet applies, so the duration stays accurate even while
 * the page is busy hydrating; a setTimeout here could fire late under that same load.
 * The only JS needed is a tiny inline <script> that decides, synchronously and before first
 * paint, whether to show it at all this session.
 */
export function SplashScreen() {
  return (
    <>
      <div id="elfatina-splash" className="elfatina-splash" aria-hidden="true">
        <div className="elfatina-splash-mark">
          <BrandMark size={52} />
        </div>
        <p className="elfatina-splash-word heading-display" dir="ltr">
          El Fatina
        </p>
        <span className="elfatina-splash-bar">
          <span className="elfatina-splash-bar-fill" />
        </span>
      </div>
      {/* Runs synchronously as the parser reaches it — before paint of anything below it. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{
            var app = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
            if (!app || sessionStorage.getItem("elfatina.splash")) {
              var s=document.getElementById("elfatina-splash");
              if (s) s.style.display = "none";
            } else {
              sessionStorage.setItem("elfatina.splash", "1");
            }
          } catch(e) {}})();`,
        }}
      />
    </>
  );
}
