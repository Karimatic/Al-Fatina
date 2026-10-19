/**
 * The one way to deploy by hand: `npm run deploy` (CI does the same steps).
 *  1. refuses uncommitted changes or another branch than main (a parallel session once left
 *     a fix on the wrong branch, and a dirty tree deploys code nobody can find in git)
 *  2. build → migration checks (history + two-release removals) → migrations → wrangler deploy
 *     tagged with the git commit (so the guard knows the live code) → live check
 * Stops at the first failure; nothing after it runs.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "apps", "worker");
const win = process.platform === "win32";

function run(cmd, args, cwd = root, { capture = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: win });
  if (r.status !== 0) {
    if (capture) console.error(r.stdout, r.stderr);
    console.error(`✗ ${cmd} ${args.join(" ")} failed — deploy stopped.`);
    process.exit(1);
  }
  return (r.stdout ?? "").trim();
}

const branch = run("git", ["branch", "--show-current"], root, { capture: true });
if (branch !== "main" && !process.argv.includes("--any-branch")) {
  console.error(`✗ on branch « ${branch} », not main: git checkout main first.`);
  process.exit(1);
}
const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"], root, { capture: true });
if (dirty) {
  console.error(`✗ uncommitted changes:\n${dirty}\nCommit them first: what is live must be in git.`);
  process.exit(1);
}
const sha = run("git", ["rev-parse", "--short=12", "HEAD"], root, { capture: true });
const subject = run("git", ["log", "-1", "--format=%s"], root, { capture: true }).slice(0, 100);

run("npm", ["run", "build"]);
run("node", ["scripts/check-migrations.mjs"]);
run("npx", ["wrangler", "d1", "migrations", "apply", "el-fatina-db", "--remote"], worker);
run("npx", ["wrangler", "deploy", "--tag", sha, "--message", JSON.stringify(subject)], worker);
run("node", ["scripts/verify-deploy.mjs", ...process.argv.slice(2).filter((a) => a.startsWith("http"))]);
console.log(`✓ deployed ${sha} (${subject})`);
