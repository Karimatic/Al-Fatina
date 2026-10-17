/** The order of a page's private link (see privateToken.ts): from the address, else from this phone. */
import { hidePrivateToken, KEY } from "./privateToken";
import { useSavedOrders } from "./stores";

export function usePrivateLink(): () => { code: string; token: string } | null {
  const saved = useSavedOrders();
  return () => {
    const { code, token } = hidePrivateToken();
    if (!code) return null;
    let tk = token;
    if (!tk) {
      try {
        tk = sessionStorage.getItem(KEY(code));
      } catch {
        tk = null;
      }
    }
    tk ??= saved.find((o) => o.code === code)?.token ?? null;
    return tk ? { code, token: tk } : { code, token: "" };
  };
}
