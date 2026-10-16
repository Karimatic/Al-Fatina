import type { ComponentType, ReactNode } from "react";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { Boundary } from "@/components/layout/Boundary";
import { BottomNav } from "@/components/layout/BottomNav";
import { ErrorReporter } from "@/components/layout/ErrorReporter";
import { FloatingHelp } from "@/components/layout/FloatingHelp";
import { InstallPrompt } from "@/components/layout/InstallPrompt";
import { SavedCopyNotice } from "@/components/layout/SavedCopyNotice";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SplashScreen } from "@/components/layout/SplashScreen";
import { ThemeStyle } from "@/components/layout/ThemeStyle";
import { useLocale } from "@/lib/locale";
import { AdsConsent } from "@/components/layout/AdsConsent";

/** The language's texts, given by each page's own provider (a page only downloads its language). */
export type LanguageProvider = ComponentType<{ children: ReactNode }>;

function SkipLink() {
  const { t } = useLocale();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-noir focus:px-4 focus:py-2 focus:text-white"
    >
      {t.skip}
    </a>
  );
}

/**
 * Everything inside <div id="app">: the same tree is rendered to HTML at build time and then
 * brought to life in the browser (hydration), so the first paint needs no script.
 */
export function App({ Provider, children }: { Provider: LanguageProvider; children: ReactNode }) {
  return (
    <>
      <SplashScreen />
      <Provider>
        <SkipLink />
        <Boundary where="announcement" quiet>
          <AnnouncementBar />
        </Boundary>
        <Boundary where="header" quiet>
          <SiteHeader />
        </Boundary>
        <main id="main" className="flex-1">
          <Boundary where="page">{children}</Boundary>
        </main>
        <Boundary where="footer" quiet>
          <SiteFooter />
        </Boundary>
        <Boundary where="bottom-nav" quiet>
          <BottomNav />
        </Boundary>
        <Boundary where="assistant" quiet>
          <FloatingHelp />
        </Boundary>
        <Boundary where="install" quiet>
          <InstallPrompt />
        </Boundary>
        <Boundary where="saved-copy" quiet>
          <SavedCopyNotice />
        </Boundary>
        <Boundary where="ads-consent" quiet>
          <AdsConsent />
        </Boundary>
        <ThemeStyle />
        <ErrorReporter />
      </Provider>
    </>
  );
}

/** Classes of the page frame (on #app): a column filling the screen, room for the phone tab bar. */
export const APP_CLASS = "flex min-h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0";
