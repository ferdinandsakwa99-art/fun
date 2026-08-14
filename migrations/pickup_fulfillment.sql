-- Pickup (fulfillment) orders
-- Run this against your Supabase project (SQL editor) once.
--
-- Adds a delivery_type column so customers can choose either:
--   'delivery' -- a rider delivers the order (existing behaviour).
--   'pickup'   -- the customer collects from the restaurant; no delivery fee
--                 and no rider is assigned.
-- address_id becomes optional since pickup orders have no drop-off address.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'delivery'
  CHECK (delivery_type IN ('delivery', 'pickup'));

ALTER TABLE orders
  ALTER COLUMN address_id DROP NOT NULL;
