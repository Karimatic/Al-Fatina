/**
 * Install check, run before `npm run build` and `npm test`: a broken install (an `npm install`
 * run inside apps/… or packages/…, an old Node) leaves a second copy of Preact / Vite / Vitest in a
 * sub-folder, and the tools then crash with cryptic errors ("reading 'context'", "reading
 * 'config'"). This stops early and says how to fix it.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) problems.push(`Node ${process.versions.node} is too old: install Node 22 or newer (24 is used by CI).`);

if (!existsSync(join(root, "node_modules"))) problems.push("Dependencies are not installed: run `npm ci` at the root of the project.");

/** Packages that must exist once, at the root (the workspaces share them). */
const SINGLE = ["preact", "preact-render-to-string", "vite", "vitest", "react", "react-dom"];
const workspaces = ["apps", "packages"].flatMap((d) =>
  existsSync(join(root, d)) ? readdirSync(join(root, d), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, d, e.name)) : [],
);
const version = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
};
for (const name of SINGLE) {
  const top = version(join(root, "node_modules", name));
  for (const ws of workspaces) {
    const nested = join(ws, "node_modules", name);
    const v = version(nested);
    // even an identical second copy breaks Preact's hooks: any copy outside the root is wrong
    if (v) problems.push(`Two copies of ${name}: ${top ?? "none"} at the root and ${v} in ${relative(root, nested)}.`);
  }
}

if (problems.length) {
  console.error("\n✗ The install of this project is broken:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    "\n  Fix: delete every node_modules folder, then run `npm ci` once, at the root of the project\n" +
      "  (never `npm install` inside apps/… or packages/…).\n",
  );
  process.exit(1);
}
console.log("✓ install OK (Node " + process.versions.node + ", one copy of " + SINGLE.filter((n) => version(join(root, "node_modules", n))).join(", ") + ")");
