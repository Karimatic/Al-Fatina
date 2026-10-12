import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// the admin API is split by tab, one file each: every file's routes must be mounted in index.ts
describe("admin route files", () => {
  it("are all mounted", () => {
    const dir = __dirname;
    const index = readFileSync(join(dir, "index.ts"), "utf8");
    const unmounted: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "index.ts")) {
      const m = /export const (\w+Routes) = new Hono/.exec(readFileSync(join(dir, f), "utf8"));
      if (m && !index.includes(`adminRoutes.route("/", ${m[1]});`)) unmounted.push(`${f}: ${m[1]}`);
    }
    expect(unmounted).toEqual([]);
  });
});
