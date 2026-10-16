/**
 * Migration 0011 rewrites the privacy page (no saved checkouts, the ad pixels with consent),
 * but only when the shop never edited it: an edited page is kept as the shop wrote it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testDb } from "../test/db";

const MIGRATION = readFileSync(join(__dirname, "../../../../packages/db/migrations/0011_privacy_pixels.sql"), "utf8");
// the page as it was first published (live until this migration)
const original = (JSON.parse(readFileSync(join(__dirname, "../test/privacy-original.json"), "utf8")) as { slug: string; titleFr: string; titleAr: string; bodyFr: string; bodyAr: string }[]).find(
  (p) => p.slug === "confidentialite",
)!;

function withPage(bodyFr: string) {
  const db = testDb();
  db.sqlite.prepare("INSERT INTO pages (slug, title_fr, title_ar, body_fr, body_ar, is_active) VALUES ('confidentialite', ?, ?, ?, ?, 1)").run(original.titleFr, original.titleAr, bodyFr, original.bodyAr);
  db.sqlite.exec(MIGRATION);
  return db.sqlite.prepare("SELECT body_fr, body_ar FROM pages WHERE slug = 'confidentialite'").get() as { body_fr: string; body_ar: string };
}

describe("privacy page migration", () => {
  it("updates the never-edited page: pixels explained, no more saved checkouts", () => {
    const page = withPage(original.bodyFr);
    expect(page.body_fr).toContain("Meta");
    expect(page.body_fr).toContain("TikTok");
    expect(page.body_fr).not.toContain("Commande non terminée");
    expect(page.body_ar).toContain("TikTok");
    expect(page.body_ar).not.toContain("طلب لم يكتمل");
  });

  it("keeps a page the shop edited", () => {
    expect(withPage("Notre texte à nous.").body_fr).toBe("Notre texte à nous.");
  });
});
