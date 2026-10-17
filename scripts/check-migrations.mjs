/**
 * Before `d1 migrations apply` (audit DATA-2): does the live database's migration history match
 * the files? The production history was once recorded by hand: a name in the database that no
 * file has, or a file missing between applied ones, would make `apply` skip or re-run a step.
 * Read-only. Prints what will be applied; exit 1 on any mismatch.
 *   node scripts/check-migrations.mjs        (needs a Cloudflare login or CLOUDFLARE_API_TOKEN)
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "apps", "worker");
const files = readdirSync(join(root, "packages", "db", "migrations")).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

// Windows runs npx through a shell: quote arguments there (on Linux they are passed as they are)
const arg = (s) => (process.platform === "win32" ? JSON.stringify(s) : s);
let out = "";
for (let attempt = 1; attempt <= 3; attempt++) {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--json", "--command", arg("SELECT name FROM d1_migrations ORDER BY id")], {
    cwd: worker, encoding: "utf8", shell: process.platform === "win32",
  });
  if (r.status === 0) {
    out = r.stdout;
    break;
  }
  if (attempt === 3) {
    console.error(r.stdout, r.stderr);
    process.exit(1);
  }
}
const applied = JSON.parse(out.replace(/^[^[]*/s, ""))[0].results.map((r) => r.name);

const problems = [];
const unknown = applied.filter((n) => !files.includes(n));
if (unknown.length) problems.push(`recorded in the database but no such file: ${unknown.join(", ")}`);
// applied ones must be exactly the first files, in order (no hole)
applied.forEach((n, i) => {
  if (files[i] !== n) problems.push(`position ${i + 1}: database has ${n}, files have ${files[i] ?? "nothing"}`);
});
const pending = files.slice(applied.length);

// Removals ship in two releases (expand / contract, audit R5-2): first the code stops using a
// table or column, then a later migration named "…contract…" drops it — never the same release,
// or orders fail between "migration applied" and "new code live".
const workerSrc = join(root, "apps", "worker", "src");
const codeFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? codeFiles(join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const code = codeFiles(workerSrc).map((f) => readFileSync(f, "utf8")).join("\n");
for (const f of pending) {
  const sql = readFileSync(join(root, "packages", "db", "migrations", f), "utf8");
  const drops = [...sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)/gi)].map((m) => m[1])
    .concat([...sql.matchAll(/DROP\s+COLUMN\s+[`"]?(\w+)/gi)].map((m) => m[1]));
  if (!drops.length) continue;
  if (!/contract/i.test(f)) problems.push(`${f} drops ${drops.join(", ")}: name it …contract… and ship it after the code stopped using it`);
  for (const name of drops) {
    if (new RegExp(`\\b${name}\\b`).test(code)) problems.push(`${f} drops "${name}" but apps/worker/src still uses it: release the code change first`);
  }
}

if (problems.length) {
  console.error("✗ Migrations not safe to apply:");
  for (const p of problems) console.error(`  • ${p}`);
  console.error("  Nothing was applied. See docs/RUNBOOK.md §1 (history fixes, two-step removals).");
  process.exit(1);
}
console.log(`✓ migration history OK: ${applied.length} applied${pending.length ? `, to apply now: ${pending.join(", ")}` : ", nothing to apply"}`);
