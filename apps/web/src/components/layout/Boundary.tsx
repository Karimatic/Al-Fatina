import { Component, type ReactNode } from "react";
import { useLocale } from "@/lib/locale";

/** Sends a drawing error to Admin → Erreurs (the window "error" listener never sees these). */
function reportRenderError(error: unknown, where: string) {
  const e = error instanceof Error ? error : new Error(String(error));
  fetch("/api/log", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `[${where}] ${e.message}`.slice(0, 500), stack: e.stack?.slice(0, 4000), url: location.pathname }),
  }).catch(() => undefined);
}

function PageError() {
  const { t } = useLocale();
  return (
    <div role="alert" className="mx-auto my-10 max-w-md rounded-3xl border border-line bg-surface p-6 text-center">
      <p className="text-sm text-ink-soft">{t.common.error}</p>
      <button type="button" onClick={() => location.reload()} className="mt-4 inline-flex h-11 items-center rounded-full bg-plum-600 px-6 font-semibold text-on-ink">
        {t.common.retry}
      </button>
    </div>
  );
}

/**
 * One part of the page failing while it draws (bad data in a review, a flash sale…) no longer
 * blanks the whole page (audit REL-2): a side widget just disappears, the main content shows
 * "reload", and the error reaches Admin → Erreurs.
 */
export class Boundary extends Component<{ where: string; quiet?: boolean; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    reportRenderError(error, this.props.where);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return this.props.quiet ? null : <PageError />;
  }
}
