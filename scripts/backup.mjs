/**
 * Off-site backup of the shop's database (audit DATA-1): `wrangler d1 export` of the live D1,
 * encrypted with a passphrase (AES-256-GCM, key from scrypt), plus the row count of every table
 * (not sensitive: used by scripts/restore-drill.mjs to prove the backup restores completely).
 *
 *   BACKUP_PASSPHRASE=… node scripts/backup.mjs [out-dir]        (default: backups/)
 *
 * Needs a Cloudflare login (local) or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (GitHub job).
 * The export holds customer data: only the encrypted file is kept, the plain SQL is deleted.
 * Decrypt for a real restore: node scripts/restore-drill.mjs --decrypt <file.enc> <out.sql>
 */
import { spawnSync } from "node:child_process";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "apps", "worker");
const out = resolve(process.argv[2] ?? join(root, "backups"));
const pass = process.env.BACKUP_PASSPHRASE;
if (!pass || pass.length < 16) {
  console.error("✗ BACKUP_PASSPHRASE is missing (16 characters or more): the backup is never stored unencrypted.");
  process.exit(1);
}

// Windows runs npx through a shell: quote arguments there (on Linux they are passed as they are)
const arg = (s) => (process.platform === "win32" ? JSON.stringify(s) : s);
// a network hiccup must not lose the week's backup: each call is tried 3 times
const wrangler = (args) => {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync("npx", ["wrangler", ...args], { cwd: worker, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0) return r.stdout;
    if (attempt >= 3) {
      console.error(r.stdout, r.stderr);
      throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`);
    }
    console.warn(`… wrangler ${args.slice(0, 3).join(" ")} failed, trying again (${attempt}/3)`);
  }
};
const query = (sql) => {
  const json = JSON.parse(wrangler(["d1", "execute", "DB", "--remote", "--json", "--command", arg(sql)]).replace(/^[^[]*/s, ""));
  return json[0].results;
};

mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const plain = join(out, `henine-${stamp}.sql`);
try {
  // 1. the whole database as SQL
  wrangler(["d1", "export", "DB", "--remote", "--output", arg(plain)]);
  // 2. rows per table, at the same moment (a few seconds apart)
  const tables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name").map((r) => r.name);
  // one row, one column per table (D1 refuses many SELECTs joined with UNION)
  const counts = query(`SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM "${t}") AS "${t}"`).join(", ")}`)[0];
  // 3. encrypted: magic | salt | iv | tag | data
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(readFileSync(plain)), cipher.final()]);
  const file = `${plain}.enc`;
  writeFileSync(file, Buffer.concat([Buffer.from("HNB1"), salt, iv, cipher.getAuthTag(), data]));
  writeFileSync(join(out, `henine-${stamp}.counts.json`), JSON.stringify({ at: new Date().toISOString(), counts }, null, 2));
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`✓ ${file} (${Math.round(data.length / 1024)} KB, ${tables.length} tables, ${rows} rows)`);
} finally {
  rmSync(plain, { force: true });
}
