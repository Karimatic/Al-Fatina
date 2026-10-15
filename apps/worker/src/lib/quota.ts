/**
 * The database's daily free quota (audit REL-4): D1 Free stops every query — orders included —
 * past 5 M rows read or 100 k rows written in a UTC day. Every 30 minutes the account's usage is
 * read from Cloudflare's analytics (GraphQL) and the team is told on Telegram when it passes 50 %
 * and again at 80 %, once each per day.
 *
 * Needs two Worker secrets (docs/RUNBOOK.md §5): CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN (an API
 * token with only « Account Analytics: Read »). Without them it does nothing.
 */
import type { Env } from "../env";
import { getSettings, setSetting } from "./settings";
import { sendTelegramText } from "./telegram";

export const D1_FREE_DAILY = { rowsRead: 5_000_000, rowsWritten: 100_000 } as const;
const LEVELS = [80, 50] as const;

const QUERY = `query ($account: String!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date: $day }) { sum { rowsRead rowsWritten } }
  } }
}`;

/** Today's rows read / written over every database of the account (UTC day, like the quota). */
export async function d1UsageToday(env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ rowsRead: number; rowsWritten: number } | null> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
  const res = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { account: env.CF_ACCOUNT_ID, day: new Date(now).toISOString().slice(0, 10) } }),
  });
  if (!res.ok) throw new Error(`d1 usage: HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { viewer?: { accounts?: { d1AnalyticsAdaptiveGroups?: { sum: { rowsRead: number; rowsWritten: number } }[] }[] } };
    errors?: { message: string }[] | null;
  };
  if (json.errors?.length) throw new Error(`d1 usage: ${json.errors[0]!.message}`);
  const groups = json.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups ?? [];
  return groups.reduce((t, g) => ({ rowsRead: t.rowsRead + (g.sum.rowsRead ?? 0), rowsWritten: t.rowsWritten + (g.sum.rowsWritten ?? 0) }), { rowsRead: 0, rowsWritten: 0 });
}

/** The 30-minute check: a Telegram message when a new level (50 %, 80 %) is passed today. */
export async function quotaCheck(env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<void> {
  const usage = await d1UsageToday(env, now, fetcher);
  if (!usage) return;
  const readPct = Math.round((usage.rowsRead / D1_FREE_DAILY.rowsRead) * 100);
  const writePct = Math.round((usage.rowsWritten / D1_FREE_DAILY.rowsWritten) * 100);
  const level = LEVELS.find((l) => Math.max(readPct, writePct) >= l);
  if (!level) return;
  const day = new Date(now).toISOString().slice(0, 10);
  const { quota_notice: last } = await getSettings(env, ["quota_notice"]);
  if (last.day === day && last.level >= level) return; // already told today
  await setSetting(env, "quota_notice", { day, level });
  await sendTelegramText(
    env,
    [
      `${level >= 80 ? "🔴" : "🟠"} <b>Base de données : ${Math.max(readPct, writePct)} % du quota gratuit du jour</b>`,
      `Lectures : ${usage.rowsRead.toLocaleString("fr-FR")} / 5 M (${readPct} %) · Écritures : ${usage.rowsWritten.toLocaleString("fr-FR")} / 100 k (${writePct} %)`,
      "À 100 %, plus aucune commande n'est enregistrée jusqu'à 01:00. Voir docs/RUNBOOK.md §5 (forfait Workers Paid à 5 $/mois).",
    ].join("\n"),
  );
}
