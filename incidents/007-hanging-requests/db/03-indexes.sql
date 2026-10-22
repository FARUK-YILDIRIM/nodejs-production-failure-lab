-- Secondary indexes, created after the bulk load.

CREATE INDEX products_created_idx ON products (created_at DESC, id DESC);
CREATE INDEX products_category_created_idx ON products (category_id, created_at DESC, id DESC);

CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at);

CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_product_id_idx ON order_items (product_id) INCLUDE (quantity);

INSERT INTO schema_migrations (version) VALUES ('0001_baseline'), ('0002_orders_tax'), ('0003_order_items_product_index'), ('0004_coupons');

ANALYZE;

-- Start with clean query statistics (the seed itself is not interesting).
SELECT pg_stat_statements_reset();
