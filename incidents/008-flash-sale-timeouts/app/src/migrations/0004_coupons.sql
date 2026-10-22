-- 2.22.0: coupon codes at checkout.
CREATE TABLE IF NOT EXISTS coupons (
  code             text PRIMARY KEY,
  percent_off      integer NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  expires_at       timestamptz NOT NULL,
  max_redemptions  integer,
  redemptions      integer NOT NULL DEFAULT 0
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
