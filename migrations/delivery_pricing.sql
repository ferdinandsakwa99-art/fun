-- Delivery fee & rider payout support
-- Run this against your Supabase project (SQL editor) once.
--
-- Customer delivery fee: 70 KSh base + 30 KSh/km (min 70).
-- Rider payout:          60 KSh base + 20 KSh/km (min 60).
-- distance_km is computed once (Haversine between restaurant and the
-- customer's delivery address) and reused for both, so the server never
-- calls the maps API twice for the same order.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS distance_km numeric(10, 2) DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rider_pay numeric(12, 2) DEFAULT 0;
