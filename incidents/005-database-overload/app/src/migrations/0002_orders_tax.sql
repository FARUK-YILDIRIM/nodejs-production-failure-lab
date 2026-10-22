-- 2.19.0: orders store the sales tax / VAT quoted by TaxRate.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0;
