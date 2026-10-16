-- Abandoned checkouts (Admin → Paniers) are removed: the owner found them unnecessary. The saved
-- names and phone numbers go with the table, and the « Paniers » right leaves every role.
DROP TABLE IF EXISTS `carts`;--> statement-breakpoint
UPDATE `roles` SET `permissions` = (SELECT json_group_array(value) FROM json_each(`roles`.`permissions`) WHERE value != 'carts.view') WHERE `permissions` LIKE '%carts.view%';
