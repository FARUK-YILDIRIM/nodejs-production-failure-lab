-- no-transaction
-- One order per customer and Idempotency-Key, even when two attempts of the same
-- checkout race each other. CONCURRENTLY: orders keep coming in while it's built.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS orders_customer_idempotency_key_idx
    ON orders (customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
