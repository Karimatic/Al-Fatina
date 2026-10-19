/**
 * Restore drill (audit DATA-1): a backup made by scripts/backup.mjs is decrypted, loaded into a
 * throwaway local database (apps/worker/.wrangler/restore-drill, never the dev or live one), and
 * every table's row count is compared with the counts recorded at backup time.
 *
 *   BACKUP_PASSPHRASE=… node scripts/restore-drill.mjs <backups/elfatina-….sql.enc>
 *   BACKUP_PASSPHRASE=… node scripts/restore-drill.mjs --decrypt <file.enc> <out.sql>   (real restore, see docs/RUNBOOK.md)
 */
import { spawnSync } from "node:child_process";
import { createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "apps", "worker");
const pass = process.env.BACKUP_PASSPHRASE;
if (!pass) {
  console.error("✗ BACKUP_PASSPHRASE is missing.");
  process.exit(1);
}

function decrypt(file) {
  const b = readFileSync(file);
  if (b.subarray(0, 4).toString() !== "HNB1") throw new Error("not a El Fatina backup file");
  const salt = b.subarray(4, 20);
  const iv = b.subarray(20, 32);
  const tag = b.subarray(32, 48);
  const d = createDecipheriv("aes-256-gcm", scryptSync(pass, salt, 32), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(b.subarray(48)), d.final()]); // a wrong passphrase or a damaged file throws here
}

/**
 * The export lists each table with its rows, alphabetically: rows of a table pointing to another
 * (sessions → team_members) come before that table exists, and the import stops. Safe order:
 * every table first, then the rows (in their order), then the indexes. Statements are split on
 * ";" outside quotes (product descriptions hold line breaks and semicolons).
 */
function safeOrder(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = sql[i + 1] === quote ? (i++, quote) : null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === ";") {
      const st = sql.slice(start, i).trim();
      if (st) statements.push(st);
      start = i + 1;
    }
  }
  const rest = sql.slice(start).trim();
  if (rest) statements.push(rest);
  const kind = (st) => (/^PRAGMA/i.test(st) ? 0 : /^CREATE TABLE/i.test(st) ? 1 : /^CREATE (UNIQUE )?INDEX/i.test(st) ? 3 : 2);
  return statements
    .map((st, i) => ({ st, i, k: kind(st) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => `${x.st};`)
    .join("\n");
}

if (process.argv[2] === "--decrypt") {
  writeFileSync(resolve(process.argv[4]), safeOrder(decrypt(resolve(process.argv[3])).toString("utf8")));
  console.log(`✓ decrypted to ${process.argv[4]} — it holds customer data: delete it after use.`);
  process.exit(0);
}

const enc = resolve(process.argv[2] ?? "");
if (!existsSync(enc)) {
  console.error("Usage: node scripts/restore-drill.mjs <backups/elfatina-….sql.enc>");
  process.exit(1);
}
const expected = JSON.parse(readFileSync(enc.replace(/\.sql\.enc$/, ".counts.json"), "utf8")).counts;
// Windows runs npx through a shell: quote arguments there (on Linux they are passed as they are)
const arg = (s) => (process.platform === "win32" ? JSON.stringify(s) : s);
const sql = join(worker, ".wrangler", "restore-drill.sql");
const persist = ".wrangler/restore-drill";
const wrangler = (args) => {
  const r = spawnSync("npx", ["wrangler", ...args], { cwd: worker, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "1" } });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`);
  }
  return r.stdout;
};

rmSync(join(worker, persist), { recursive: true, force: true });
try {
  writeFileSync(sql, safeOrder(decrypt(enc).toString("utf8")));
  wrangler(["d1", "execute", "DB", "--local", "--persist-to", persist, "--file", relative(worker, sql).replace(/\\/g, "/")]);
  const tables = Object.keys(expected);
  const q = `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM "${t}") AS "${t}"`).join(", ")}`;
  const got = JSON.parse(wrangler(["d1", "execute", "DB", "--local", "--persist-to", persist, "--json", "--command", arg(q)]).replace(/^[^[]*/s, ""))[0].results[0];
  const bad = tables.filter((t) => got[t] !== expected[t]);
  for (const t of tables) console.log(`${bad.includes(t) ? "✗" : "✓"} ${t.padEnd(28)} ${String(expected[t]).padStart(7)} → ${got[t] ?? "missing"}`);
  if (bad.length) {
    console.error(`✗ restore drill failed: ${bad.length} table(s) differ`);
    process.exit(1);
  }
  console.log(`✓ restore drill passed: ${tables.length} tables, every row back`);
} finally {
  rmSync(sql, { force: true });
  rmSync(join(worker, persist), { recursive: true, force: true });
}
