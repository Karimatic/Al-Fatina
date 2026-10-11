/**
 * The store's side of the invisible bot check (worker: lib/form-guard.ts). A form takes a signed
 * ticket when it appears, sends it with its data and an empty hidden field. If the customer is
 * faster than the ticket's minimum age, the form waits the few remaining tenths of a second; if
 * the ticket was refused (expired, page open for hours), it takes a fresh one and sends again.
 * Nothing to see, nothing to tick.
 */
import { useCallback, useEffect, useRef } from "react";
import { ApiError, apiGet } from "@/lib/api";

interface Ticket {
  ticket: string;
  /** when it was received, on this phone's clock */
  receivedAt: number;
  minAgeMs: number;
}

let shared: Promise<Ticket> | null = null;

function fetchTicket(): Promise<Ticket> {
  return apiGet<{ ticket: string; minAgeMs: number }>("/form-ticket").then((t) => ({ ticket: t.ticket, minAgeMs: t.minAgeMs, receivedAt: Date.now() }));
}

/** one ticket per page, taken early; a fresh one after 5 hours or when refused */
function ticket(fresh = false): Promise<Ticket> {
  if (fresh || !shared) shared = fetchTicket().catch((err) => ((shared = null), Promise.reject(err)));
  return shared.then((t) => (Date.now() - t.receivedAt > 5 * 3_600_000 ? ticket(true) : t));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useFormGuard() {
  const trap = useRef<HTMLInputElement>(null);
  // take the ticket as soon as the form shows, so it is old enough by the time she sends
  useEffect(() => void ticket().catch(() => undefined), []);

  const send = useCallback(async <T,>(post: (guard: { ticket: string; hp?: string }) => Promise<T>): Promise<T> => {
    const once = async (fresh: boolean) => {
      const t = await ticket(fresh);
      const left = t.minAgeMs + 250 - (Date.now() - t.receivedAt);
      if (left > 0) await wait(left);
      const hp = trap.current?.value || undefined;
      return post({ ticket: t.ticket, hp });
    };
    try {
      return await once(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "form_expired") return once(true);
      throw err;
    }
  }, []);

  /** the hidden field: off screen, out of the tab order, ignored by autofill and screen readers */
  const Trap = useCallback(
    () => (
      <input
        ref={trap}
        type="text"
        name="hn_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="pointer-events-none absolute -start-[9999px] size-px opacity-0"
        defaultValue=""
      />
    ),
    [],
  );

  return { send, Trap };
}
