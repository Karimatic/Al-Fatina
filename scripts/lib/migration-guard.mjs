/**
 * Expand / contract (audits R5-2, R6-2): a migration may drop a table or a column only when
 *  - its file name says « contract » (a removal shipped on purpose, in its own release), and
 *  - neither the code being deployed NOR the code live right now uses that name: migrations run
 *    before the new Worker is live, so the live code must already have stopped using it.
 * Pure functions, tested by migration-guard.test.mjs.
 */

/** Tables and columns a migration drops. */
export function dropsIn(sql) {
  const names = [];
  for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?(\w+)/gi)) names.push(m[1]);
  for (const m of sql.matchAll(/DROP\s+COLUMN\s+[`"[]?(\w+)/gi)) names.push(m[1]);
  return names;
}

const uses = (code, name) => new RegExp(`\\b${name}\\b`).test(code);

/**
 * Problems of one pending migration. `liveCode` is the Worker source of the version live now
 * (null when unknown: deployed without its commit tag), `releaseCode` the source being deployed.
 */
export function dropProblems({ file, sql, releaseCode, liveCode }) {
  const drops = dropsIn(sql);
  if (!drops.length) return [];
  const problems = [];
  if (!/contract/i.test(file)) problems.push(`${file} drops ${drops.join(", ")}: name it …contract… and ship it after the code stopped using it`);
  if (liveCode == null) problems.push(`${file} drops ${drops.join(", ")} but the live version's code is unknown (deployed without its commit): deploy once with « npm run deploy », then apply it`);
  for (const name of drops) {
    if (uses(releaseCode, name)) problems.push(`${file} drops "${name}" but the code being deployed still uses it`);
    if (liveCode != null && uses(liveCode, name)) problems.push(`${file} drops "${name}" but the code live now still uses it: release the code change first, then this migration`);
  }
  return problems;
}
