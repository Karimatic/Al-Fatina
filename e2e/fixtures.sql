-- Browser tests only (scripts/e2e-server.mjs), on top of the demo data: one photo record so
-- the product lists that show photographed products are not empty (the file itself is absent).
INSERT INTO product_images (product_id, base_key, widths, width, height, alt_fr, alt_ar, sort)
VALUES (1, 'e2e/p1', '[480]', 480, 600, 'Pyjama short coton fleuri', 'بيجامة شورت قطن مزهرة', 0);
-- enough stock for every test run and retry
UPDATE variants SET stock_on_hand = 1000 WHERE product_id = 1;
