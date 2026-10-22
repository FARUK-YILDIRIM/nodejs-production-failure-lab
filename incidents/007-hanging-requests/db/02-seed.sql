-- Deterministic sample data: 40 categories, 20k products, 50k customers and
-- 484k orders (~1.2M order items) placed between 2024-07-01 and 2026-06-30.
--
-- Random values are drawn in subqueries fenced with OFFSET 0 so the planner can't
-- inline them into join conditions (where random() would be re-evaluated per row).

SELECT setseed(0.42);

CREATE TEMPORARY TABLE category_seed (position int PRIMARY KEY, name text, noun text);
INSERT INTO category_seed (position, name, noun) VALUES
  (1, 'Laptops', 'Laptop'), (2, 'Smartphones', 'Smartphone'), (3, 'Tablets', 'Tablet'),
  (4, 'Headphones', 'Headphones'), (5, 'Smartwatches', 'Smartwatch'), (6, 'Cameras', 'Camera'),
  (7, 'Monitors', 'Monitor'), (8, 'Keyboards', 'Keyboard'), (9, 'Mice', 'Mouse'),
  (10, 'Printers', 'Printer'), (11, 'Routers', 'Router'), (12, 'Speakers', 'Speaker'),
  (13, 'Televisions', 'TV'), (14, 'Gaming Consoles', 'Console'), (15, 'Drones', 'Drone'),
  (16, 'E-readers', 'E-reader'), (17, 'Chargers', 'Charger'), (18, 'Cables', 'Cable'),
  (19, 'Storage', 'SSD'), (20, 'Smart Home', 'Smart Plug'), (21, 'Kitchen Appliances', 'Blender'),
  (22, 'Coffee Machines', 'Espresso Machine'), (23, 'Vacuum Cleaners', 'Vacuum'), (24, 'Lighting', 'Desk Lamp'),
  (25, 'Furniture', 'Bookshelf'), (26, 'Office Chairs', 'Office Chair'), (27, 'Desks', 'Standing Desk'),
  (28, 'Backpacks', 'Backpack'), (29, 'Luggage', 'Suitcase'), (30, 'Running Shoes', 'Running Shoe'),
  (31, 'Sneakers', 'Sneaker'), (32, 'Jackets', 'Jacket'), (33, 'T-Shirts', 'T-Shirt'),
  (34, 'Watches', 'Watch'), (35, 'Sunglasses', 'Sunglasses'), (36, 'Fitness Trackers', 'Fitness Band'),
  (37, 'Yoga Gear', 'Yoga Mat'), (38, 'Bicycles', 'Bicycle'), (39, 'Camping Gear', 'Tent'),
  (40, 'Books', 'Hardcover');

INSERT INTO categories (slug, name)
SELECT lower(regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g')), name
  FROM category_seed
 ORDER BY position;

-- Products: "<Brand> <Edition> <Noun> <Model>", e.g. "Orbix Pro Laptop 451".
-- A few editions contain commas and quotes, as real catalog data does.
INSERT INTO products (sku, name, description, category_id, price_cents, created_at)
SELECT
  'SKU-' || lpad(s.g::text, 6, '0'),
  (ARRAY['Orbix', 'Novatek', 'Lumio', 'Kestrel', 'Zentra', 'Halcyon', 'Pyxis', 'Vantor', 'Aurelia', 'Brisa',
         'Corvo', 'Dynex', 'Elaris', 'Fjord', 'Gryph'])[1 + (s.g % 15)]
    || ' ' ||
  (ARRAY['Pro', 'Ultra', 'Lite', 'Max', 'Air', 'Mini', 'Plus', 'Studio', 'Sport', 'Classic',
         'Lite, Refurbished', '"Signature"', 'Go', 'Prime', 'Edge', 'Flex'])[1 + ((s.g / 15) % 16)]
    || ' ' || cs.noun || ' ' || (100 + (s.g * 7919) % 900),
  'A dependable ' || lower(cs.noun) || ' for everyday use. '
    || (ARRAY['Built from recycled aluminium and tested for years of daily wear.',
              'Designed with our partners in Lisbon, assembled and quality-checked in the EU.',
              'Ships carbon-neutral in plastic-free packaging, ready to use out of the box.',
              'Rated 4.6 out of 5 by more than two thousand verified customers.',
              'Pairs with the ShopFlow app for setup tips, firmware updates and support.',
              'Lightweight, compact and easy to clean, with a minimalist matte finish.'])[1 + (s.g % 6)]
    || ' Free returns within 30 days and a two-year limited warranty.',
  c.id,
  s.price_cents,
  timestamptz '2024-01-01 00:00:00+00' + (s.g * interval '50 minutes')
FROM (
  SELECT g, 1 + floor(random() * 40)::int AS category_position, 499 + floor(random() * 150000)::int AS price_cents
    FROM generate_series(1, 20000) AS g
  OFFSET 0
) s
JOIN category_seed cs ON cs.position = s.category_position
JOIN categories c ON c.name = cs.name
ORDER BY s.g;

INSERT INTO customers (email, name, country, created_at)
SELECT
  lower(first_name) || '.' || lower(last_name) || g || '@example.com',
  first_name || ' ' || last_name,
  country,
  created_at
FROM (
  SELECT g,
    (ARRAY['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Ken', 'Barbara', 'Dennis', 'Radia', 'Guido',
           'Frances', 'Brendan', 'Katherine', 'James', 'Sophie', 'Edsger', 'Hedy', 'Tim', 'Joan', 'Anders'])[1 + floor(random() * 20)::int] AS first_name,
    (ARRAY['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Thompson', 'Liskov', 'Ritchie', 'Perlman', 'Rossum',
           'Allen', 'Eich', 'Johnson', 'Gosling', 'Wilson', 'Dijkstra', 'Lamarr', 'Berners-Lee', 'Clarke', 'Hejlsberg'])[1 + floor(random() * 20)::int] AS last_name,
    (ARRAY['US', 'GB', 'DE', 'FR', 'NL', 'TR', 'ES', 'IT', 'CA', 'SE'])[1 + floor(random() * 10)::int] AS country,
    timestamptz '2023-01-01 00:00:00+00' + random() * interval '1000 days' AS created_at
  FROM generate_series(1, 50000) AS g
  OFFSET 0
) people
ORDER BY g;

-- Orders are spread evenly over two years (~663 a day); ids grow with time.
INSERT INTO orders (customer_id, status, total_cents, created_at)
SELECT
  customer_id,
  CASE
    WHEN r < 0.85 THEN 'delivered'
    WHEN r < 0.93 THEN 'shipped'
    WHEN r < 0.97 THEN 'paid'
    ELSE 'refunded'
  END,
  0,
  timestamptz '2024-07-01 00:00:00+00' + (g - 1) * (interval '730 days' / 484000) + jitter
FROM (
  SELECT g, 1 + floor(random() * 50000)::int AS customer_id, random() AS r, random() * interval '1 minute' AS jitter
    FROM generate_series(1, 484000) AS g
  OFFSET 0
) seeded
ORDER BY g;

-- One to four items per order. Referencing o.id makes generate_series run per order.
INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
SELECT items.order_id, items.product_id, items.quantity, p.price_cents
FROM (
  SELECT o.id AS order_id,
         n,
         1 + floor(random() * 20000)::int AS product_id,
         1 + floor(power(random(), 3) * 4)::int AS quantity
    FROM orders o
   CROSS JOIN LATERAL generate_series(1, 1 + floor(random() * 4)::int + o.id * 0) AS n
  OFFSET 0
) items
JOIN products p ON p.id = items.product_id
ORDER BY items.order_id, items.n;

UPDATE orders o
   SET total_cents = totals.total_cents
  FROM (SELECT order_id, sum(quantity * unit_price_cents)::int AS total_cents FROM order_items GROUP BY order_id) totals
 WHERE totals.order_id = o.id;

-- Coupons: two valid ones, one that expired at the end of September, one used up.
INSERT INTO coupons (code, percent_off, expires_at, max_redemptions, redemptions) VALUES
  ('WELCOME10',   10, '2099-12-31', NULL, 18342),
  ('AUTUMN20',    20, '2099-12-31', NULL, 4211),
  ('BACK2SCHOOL', 25, '2026-09-30', NULL, 30877),
  ('VIP50',       50, '2099-12-31', 100,  100);
