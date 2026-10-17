/**
 * Browser errors that are not the shop's: code that browser extensions inject into every page
 * (crypto wallets fighting over `window.ethereum`, translators, ad blockers…). They land in
 * Admin → Erreurs although nothing on the shop is broken, so they are dropped before being
 * sent (the store) and again when received (phones still running an older store).
 */
const EXTENSION_URL = /\b(chrome|moz|safari(-web)?|ms-browser|edge)-extension:\/\//i;
const WALLET_NOISE = /\b(ethereum|web3|solana|phantom|metamask|tronweb|tronlink|coinbase(wallet)?|trustwallet|okxwallet|bitkeep|keplr)\b/i;

export function isForeignClientError(e: { message?: string | null; stack?: string | null; filename?: string | null }, origin?: string): boolean {
  const text = `${e.message ?? ""}\n${e.stack ?? ""}`;
  if (EXTENSION_URL.test(text) || EXTENSION_URL.test(e.filename ?? "")) return true;
  if (WALLET_NOISE.test(e.message ?? "")) return true;
  // the file the error comes from is another site's (or no file and no stack: a cross-origin « Script error. »)
  if (origin && e.filename && !e.filename.startsWith(origin)) return true;
  if (/^(uncaught )?script error\.?$/i.test((e.message ?? "").trim()) && !e.stack) return true;
  return false;
}
