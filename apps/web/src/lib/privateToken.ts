/**
 * The private order link (/merci?c=CODE&t=TOKEN, /suivi?c=…&t=…): the token opens her order and
 * can cancel it or change the address. It must never stay in the address bar, where Meta's and
 * TikTok's pixels read the page address (audit R5-1). Read it once, keep it on this phone for the
 * session, and put back an address with the code only.
 */
export const KEY = (code: string) => `henine.link.${code}`;

/** Removes the token (and anything like it) from the address bar; returns what was there. */
export function hidePrivateToken(): { code: string | null; token: string | null } {
  const url = new URL(location.href);
  const code = url.searchParams.get("c");
  const token = url.searchParams.get("t");
  if (token != null) {
    if (code) {
      try {
        sessionStorage.setItem(KEY(code), token);
      } catch {
        /* private mode: the saved orders still have it */
      }
    }
    url.searchParams.delete("t");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
  return { code, token };
}
