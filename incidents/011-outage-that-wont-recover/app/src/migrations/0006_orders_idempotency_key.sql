-- A retried checkout must find the order it already placed: orders remember the
-- Idempotency-Key the app sent with the checkout that created them.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
