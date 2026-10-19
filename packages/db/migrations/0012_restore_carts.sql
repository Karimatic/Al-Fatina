-- El Fatina wants the abandoned checkouts (Admin → Paniers), which Henine removed in 0010: the table
-- comes back as it was, and the « Paniers » right goes back to the roles that had it.
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`items` text NOT NULL,
	`phone` text,
	`name` text,
	`wilaya_code` integer,
	`commune_id` integer,
	`delivery_type` text,
	`channel` text,
	`locale` text,
	`value` integer DEFAULT 0 NOT NULL,
	`step` text,
	`consent` integer DEFAULT false NOT NULL,
	`recovered_order_id` integer,
	`last_contacted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `carts_updated_idx` ON `carts` (`updated_at`);--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_insert(`permissions`, '$[#]', 'carts.view') WHERE `key` IN ('manager', 'confirmation') AND `permissions` NOT LIKE '%carts.view%';
--> statement-breakpoint
-- the privacy page says again that an unfinished checkout is kept 30 days (only where missing)
UPDATE `pages` SET `body_fr` = replace(`body_fr`, '- **Avis et messages** : ', '- **Commande non terminée** : si vous saisissez votre numéro au moment de commander sans finaliser, nous le gardons **30 jours** pour pouvoir vous recontacter, puis il est supprimé.
- **Avis et messages** : ') WHERE `slug` = 'confidentialite' AND `body_fr` NOT LIKE '%Commande non terminée%';--> statement-breakpoint
UPDATE `pages` SET `body_ar` = replace(`body_ar`, '- **الآراء والرسائل**: ', '- **طلب لم يكتمل**: إذا كتبتِ رقمك أثناء الطلب دون إتمامه، نحتفظ به **30 يومًا** لنتمكن من التواصل معك، ثم يُحذف.
- **الآراء والرسائل**: ') WHERE `slug` = 'confidentialite' AND `body_ar` NOT LIKE '%طلب لم يكتمل%';