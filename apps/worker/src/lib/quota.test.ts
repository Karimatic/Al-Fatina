/**
 * The database's daily free quota (audit REL-4): read from Cloudflare's analytics, one warning
 * per level (50 %, 80 %) and per day; nothing at all without the token.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { testDb } from "../test/db";
import { getSettings } from "./settings";
import { d1UsageToday, quotaCheck } from "./quota";

const NOW = Date.parse("2026-10-15T15:00:00Z");
function cloudflare(rowsWritten: number, rowsRead = 1000) {
  const calls: { url: string; body: { variables: Record<string, string> } }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead, rowsWritten: rowsWritten - 10 } }, { sum: { rowsRead: 0, rowsWritten: 10 } }] }] } } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const envOf = () => ({ DB: testDb(), CF_ACCOUNT_ID: "acc", CF_ANALYTICS_TOKEN: "tok" }) as unknown as Env;

describe("database quota warning", () => {
  it("sums every database of the account for today's UTC day", async () => {
    const { fetcher, calls } = cloudflare(30_000);
    expect(await d1UsageToday(envOf(), NOW, fetcher)).toEqual({ rowsRead: 1000, rowsWritten: 30_000 });
    expect(calls[0]!.body.variables).toEqual({ accountTag: "acc", start: "2026-10-15", end: "2026-10-15" });
    // the query exactly as Cloudflare documents it (audit R4-1 / R5-4): lowercase string!, date range
    const q = (calls[0]!.body as unknown as { query: string }).query;
    expect(q).toContain("$accountTag: string!");
    expect(q).toMatch(/date_geq: \$start/);
    expect(q).toMatch(/date_leq: \$end/);
    expect(q).not.toContain("String!");
  });

  it("nothing without the token", async () => {
    const { fetcher, calls } = cloudflare(90_000);
    await quotaCheck({ DB: testDb() } as unknown as Env, NOW, fetcher);
    expect(calls).toHaveLength(0);
  });

  it("one notice per level and per day", async () => {
    const env = envOf();
    await quotaCheck(env, NOW, cloudflare(40_000).fetcher); // 40 %: nothing
    expect((await getSettings(env, ["quota_notice"])).quota_notice).toEqual({ day: "", level: 0 });
    await quotaCheck(env, NOW, cloudflare(55_000).fetcher);
    expect((await getSettings(env, ["quota_notice"])).quota_notice).toEqual({ day: "2026-10-15", level: 50 });
    await quotaCheck(env, NOW, cloudflare(85_000).fetcher);
    expect((await getSettings(env, ["quota_notice"])).quota_notice).toEqual({ day: "2026-10-15", level: 80 });
    await quotaCheck(env, NOW + 86400_000, cloudflare(60_000).fetcher); // a new day: told again
    expect((await getSettings(env, ["quota_notice"])).quota_notice).toEqual({ day: "2026-10-16", level: 50 });
  });
});
