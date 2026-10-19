-- The shop is named « Al Fatina » (it was « El Fatina »): the texts already saved in the database.
UPDATE `settings` SET `value` = replace(`value`, 'El Fatina', 'Al Fatina') WHERE `value` LIKE '%El Fatina%';--> statement-breakpoint
UPDATE `message_templates` SET `body_fr` = replace(`body_fr`, 'El Fatina', 'Al Fatina'), `body_ar` = replace(`body_ar`, 'El Fatina', 'Al Fatina') WHERE `body_fr` LIKE '%El Fatina%' OR `body_ar` LIKE '%El Fatina%';--> statement-breakpoint
UPDATE `pages` SET `title_fr` = replace(`title_fr`, 'El Fatina', 'Al Fatina'), `title_ar` = replace(`title_ar`, 'El Fatina', 'Al Fatina'), `body_fr` = replace(`body_fr`, 'El Fatina', 'Al Fatina'), `body_ar` = replace(`body_ar`, 'El Fatina', 'Al Fatina'), `seo_description` = replace(`seo_description`, 'El Fatina', 'Al Fatina');
