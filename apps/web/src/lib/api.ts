import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

/** A stalled mobile connection never leaves a spinner turning for minutes. */
const TIMEOUT_MS = { read: 8_000, send: 15_000 };

/** Some data on this page came from the phone's saved copy, not the shop (audit R2-4). */
export let savedCopyShown = false;
export const SAVED_COPY_EVENT = "henine:saved-copy";
function markSavedCopy() {
  if (savedCopyShown) return;
  savedCopyShown = true;
  window.dispatchEvent(new Event(SAVED_COPY_EVENT));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.method && init.method !== "GET" ? TIMEOUT_MS.send : TIMEOUT_MS.read);
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(0, ctrl.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  // the phone's saved copy (slow or no network, see public/sw.js): say so on the page
  if (res.headers.get("Server-Timing")?.includes('desc="saved"')) markSavedCopy();
  const body = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "generic", body?.details);
  return body as T;
}

/**
 * No answer from the shop (connection lost, timeout, Cloudflare 502–504): the request may or may
 * not have arrived. A business answer (4xx, "closed") is a real answer.
 */
export const isUnsure = (e: unknown) => e instanceof ApiError && (e.status === 0 || ([502, 503, 504].includes(e.status) && e.code !== "maintenance"));

/**
 * Tries again (1 s, then 3 s later) when the answer was lost: only for requests that are safe
 * to send twice (the order carries its checkout key: a second send returns the same order).
 */
export async function withRetry<T>(send: () => Promise<T>, waits: readonly number[] = [1_000, 3_000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (!isUnsure(err) || attempt >= waits.length) throw err;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

/** Reading is safe to repeat: no answer (dropped mobile connection) → once more after 1.5 s (audit REL-1). */
export const apiGet = <T,>(path: string) => withRetry(() => request<T>(path), [1_500]);
export const apiPost = <T,>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) });
/** multipart form (files): the browser sets the Content-Type with its boundary */
/** one key per checkout: a double tap or a retry never creates two orders */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const apiForm = <T,>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form, headers: {} });

/* Tiny SWR-style cache: identical GETs across components share one request. */
const cache = new Map<string, { at: number; data?: unknown; promise?: Promise<unknown> }>();
const TTL = 60_000;

/** not used for the very first render: the page's own HTML (an empty shell) must match it */
const prefilled = new Set<string>();
// answers the server already put in the page (a product page carries its product, audit R4-5):
// the page shows them at once instead of asking the API a second time
try {
  const block = typeof document === "undefined" ? null : document.getElementById("henine-prefill");
  if (block?.textContent)
    for (const [path, data] of Object.entries(JSON.parse(block.textContent) as Record<string, unknown>)) {
      cache.set(path, { at: Date.now(), data });
      prefilled.add(path);
    }
} catch {
  /* a broken block: the API is asked as usual */
}

function load<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit?.data !== undefined && Date.now() - hit.at < TTL) return Promise.resolve(hit.data as T);
  if (hit?.promise) return hit.promise as Promise<T>;
  const promise = apiGet<T>(path).then(
    (data) => {
      cache.set(path, { at: Date.now(), data });
      return data;
    },
    (err) => {
      cache.delete(path);
      throw err;
    },
  );
  cache.set(path, { at: Date.now(), promise });
  return promise;
}

export function useApi<T>(path: string | null) {
  const cached = path && !prefilled.has(path) ? (cache.get(path)?.data as T | undefined) : undefined;
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ data: cached, loading: !!path && cached === undefined });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    const fromPage = prefilled.delete(path); // from now on an ordinary cached answer
    let alive = true;
    setState((s) => ({ ...s, loading: s.data === undefined }));
    load<T>(path).then(
      (data) => alive && setState({ data, loading: false }),
      (error: ApiError) => alive && setState({ error, loading: false }),
    );
    // the page's own copy can be a few minutes old (it is cached at the edge with the page):
    // shown at once, then refreshed quietly once the page has settled (stock, « plus que N », R6-3)
    const refresh = fromPage
      ? setTimeout(() => {
          apiGet<T>(path).then(
            (data) => {
              cache.set(path, { at: Date.now(), data });
              if (alive) setState({ data, loading: false });
            },
            () => undefined, // offline or slow: the page's copy stays
          );
        }, 1500)
      : undefined;
    return () => {
      alive = false;
      clearTimeout(refresh);
    };
  }, [path, tick]);

  const reload = useCallback(() => {
    if (path) cache.delete(path);
    setTick((t) => t + 1);
  }, [path]);

  return { ...state, reload };
}

/** Slug from the current URL: /produit/<slug> or /fr/produit/<slug>. */
export function slugFromPath(pathname: string): string {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return decodeURIComponent(last);
}
