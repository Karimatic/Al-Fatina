import { useEffect } from "react";
import { isForeignClientError } from "@henine/shared";

/**
 * Sends uncaught browser errors to Admin → Erreurs (sampled, capped per page view). Errors from
 * browser extensions (wallets, translators…) are not the shop's and are not sent.
 */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const report = (message: string, stack?: string) => {
      if (sent >= 3 || Math.random() > 0.5) return;
      sent++;
      fetch("/api/log", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.slice(0, 500), stack: stack?.slice(0, 4000), url: location.pathname }),
      }).catch(() => undefined);
    };
    const onError = (e: ErrorEvent) => {
      if (isForeignClientError({ message: e.message, stack: e.error?.stack, filename: e.filename }, location.origin)) return;
      report(e.message, e.error?.stack);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = String(e.reason?.message ?? e.reason);
      if (isForeignClientError({ message, stack: e.reason?.stack }, location.origin)) return;
      report(message, e.reason?.stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
