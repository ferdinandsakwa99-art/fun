-- Settlement support for order sales and rider cash collections.
-- The earnings table was created with CHECK constraints limited to
-- type IN ('delivery_fee','bonus','tip') and status IN ('pending','paid'),
-- which silently rejected the settlement inserts used by EarningsService
-- (type 'order_sale' / 'credited'). Extend the allowed values.
-- Run this against your Supabase project (SQL editor) once.

ALTER TABLE earnings
  DROP CONSTRAINT IF EXISTS earnings_type_check;

ALTER TABLE earnings
  ADD CONSTRAINT earnings_type_check
  CHECK (type IN ('delivery_fee', 'bonus', 'tip', 'order_sale', 'cash_collection'));

ALTER TABLE earnings
  DROP CONSTRAINT IF EXISTS earnings_status_check;

ALTER TABLE earnings
  ADD CONSTRAINT earnings_status_check
  CHECK (status IN ('pending', 'paid', 'credited', 'collected'));
