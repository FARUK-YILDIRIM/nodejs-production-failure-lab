-- ShopFlow schema. Runs once, when the database volume is created.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE categories (
  id    serial PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  name  text NOT NULL
);

CREATE TABLE products (
  id           serial PRIMARY KEY,
  sku          text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text NOT NULL,
  category_id  integer NOT NULL REFERENCES categories (id),
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  country     char(2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id           serial PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES customers (id),
  status       text NOT NULL CHECK (status IN ('paid', 'shipped', 'delivered', 'refunded')),
  total_cents  integer NOT NULL,
  tax_cents    integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id                serial PRIMARY KEY,
  order_id          integer NOT NULL REFERENCES orders (id),
  product_id        integer NOT NULL REFERENCES products (id),
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL
);

-- Migrations shipped with the application (src/migrations) are recorded here.
CREATE TABLE schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
