-- Short links (/l/<slug>) are removed from the admin: the bio page links stay, tracking links
-- (Statistiques → Sources, ?utm_source=…) replace them. Old /l/ addresses open the home page.
DELETE FROM `links` WHERE `kind` = 'short';
