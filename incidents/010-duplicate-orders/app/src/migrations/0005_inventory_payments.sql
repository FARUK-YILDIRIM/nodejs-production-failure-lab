-- 2.23.0: stock is decremented at checkout, and orders keep their card authorization.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 1000 CHECK (stock >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id text;
