-- Add the 'arrived' status to the orders status CHECK constraint.
-- The orders table was created with orders_status_check limited to
-- ('pending','accepted','preparing','ready','picked_up','in_transit',
--  'delivered','cancelled'), which rejects the 'arrived' transition used
-- by riders when they reach the dropoff (500: check constraint violation).
-- Run this against your Supabase project (SQL editor) once.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'accepted', 'preparing', 'ready', 'picked_up', 'in_transit', 'arrived', 'delivered', 'cancelled'));
