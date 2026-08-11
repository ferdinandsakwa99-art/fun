-- Earnings & settlement support
-- Run this against your Supabase project (SQL editor) once.

-- Track the platform fee taken from each sale (16%).
ALTER TABLE earnings
  ADD COLUMN IF NOT EXISTS platform_fee numeric(12, 2) NOT NULL DEFAULT 0;

-- Optional metadata blob for future settlement details.
ALTER TABLE earnings
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Enforce one 'order_sale' and one 'delivery_fee' entry per order.
CREATE UNIQUE INDEX IF NOT EXISTS earnings_order_type_uidx
  ON earnings(order_id, type)
  WHERE order_id IS NOT NULL;

-- Speed up wallet/earnings lookups.
CREATE INDEX IF NOT EXISTS earnings_restaurant_idx ON earnings(restaurant_id);
CREATE INDEX IF NOT EXISTS earnings_rider_idx ON earnings(rider_id);
CREATE INDEX IF NOT EXISTS wallets_restaurant_idx ON wallets(restaurant_id);
CREATE INDEX IF NOT EXISTS wallets_rider_idx ON wallets(rider_id);
