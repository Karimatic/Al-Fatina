// node --test scripts/lib — the table-removal guard (expand / contract, audits R5-2, R6-2)
import assert from "node:assert/strict";
import { test } from "node:test";
import { dropProblems, dropsIn } from "./migration-guard.mjs";

const drop = "DROP TABLE IF EXISTS `carts`;";
const stillUsed = "await env.DB.prepare('UPDATE carts SET x = 1')";
const clean = "// nothing about it";

test("finds dropped tables and columns", () => {
  assert.deepEqual(dropsIn("DROP TABLE IF EXISTS `carts`; ALTER TABLE `orders` DROP COLUMN `old_note`;"), ["carts", "old_note"]);
  assert.deepEqual(dropsIn("CREATE TABLE x (id integer); UPDATE roles SET p = 1;"), []);
});

test("the round-5 case: the new code no longer uses the table, the LIVE code still does → refused", () => {
  const p = dropProblems({ file: "0012_contract_carts.sql", sql: drop, releaseCode: clean, liveCode: stillUsed });
  assert.equal(p.length, 1);
  assert.match(p[0], /code live now still uses it/);
});

test("allowed only when named « contract » and unused by both the release and the live code", () => {
  assert.deepEqual(dropProblems({ file: "0012_contract_carts.sql", sql: drop, releaseCode: clean, liveCode: clean }), []);
  assert.match(dropProblems({ file: "0012_remove_carts.sql", sql: drop, releaseCode: clean, liveCode: clean })[0], /name it …contract…/);
  assert.match(dropProblems({ file: "0012_contract_carts.sql", sql: drop, releaseCode: stillUsed, liveCode: clean })[0], /being deployed still uses it/);
});

test("unknown live code (deployed without its commit) → refused", () => {
  assert.match(dropProblems({ file: "0012_contract_carts.sql", sql: drop, releaseCode: clean, liveCode: null })[0], /live version's code is unknown/);
});

test("migrations without a drop are never blocked", () => {
  assert.deepEqual(dropProblems({ file: "0013_add_column.sql", sql: "ALTER TABLE products ADD video text;", releaseCode: clean, liveCode: null }), []);
});
