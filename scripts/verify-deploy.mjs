/**
 * After `wrangler deploy` (audit DEP-4): is the live shop really the build that was just made?
 * Twice a deploy reported success while the old version kept serving. Checks, for up to 3 minutes:
 *   - GET /api/health answers 200 (the Worker and the database);
 *   - the live home page loads the same script as dist/index.html (the new build is served).
 * Usage: node scripts/verify-deploy.mjs [https://shop.example]   (default: PUBLIC_ORIGIN or the live shop)
 * Exit 1 with a clear message when it doesn't match: then `npx wrangler deploy` again, or roll back.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const origin = (process.argv[2] ?? process.env.PUBLIC_ORIGIN ?? "https://al-fatina.karimmaticmz.workers.dev").replace(/\/$/, "");
const built = readFileSync(join(root, "dist", "index.html"), "utf8");
const entry = /<script type="module" src="([^"]+)"/.exec(built)?.[1];
if (!entry) {
  console.error("✗ dist/index.html has no module script: build first (npm run build).");
  process.exit(1);
}

const get = async (path) => {
  const res = await fetch(`${origin}${path}${path.includes("?") ? "&" : "?"}deploycheck=${Date.now()}`, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "elfatina-deploy-check" } });
  return { status: res.status, text: await res.text() };
};

const deadline = Date.now() + 3 * 60_000;
let last = "";
while (Date.now() < deadline) {
  try {
    const health = await get("/api/health");
    const home = await get("/");
    const live = /<script type="module" src="([^"]+)"/.exec(home.text)?.[1];
    if (health.status === 200 && live === entry) {
      console.log(`✓ ${origin}: health OK, the new build is live (${entry})`);
      process.exit(0);
    }
    last = `health ${health.status}, live script ${live ?? "none"} (expected ${entry})`;
  } catch (err) {
    last = `no answer (${err instanceof Error ? err.message : err})`;
  }
  console.log(`… waiting: ${last}`);
  await new Promise((r) => setTimeout(r, 10_000));
}
console.error(`✗ ${origin} is not serving the new build after 3 minutes: ${last}`);
console.error("  Deploy again (npx wrangler deploy in apps/worker) or roll back (npx wrangler rollback); see docs/RUNBOOK.md.");
process.exit(1);
