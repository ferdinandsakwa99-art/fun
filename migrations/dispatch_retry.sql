-- Dispatch retry queue support (run in Supabase SQL editor)
--
-- Tracks how many times we tried to assign a rider to an order and when the
-- last attempt happened so a background sweeper can re-dispatch `ready`
-- orders that failed to find a rider.

alter table public.orders
  add column if not exists dispatch_attempts integer not null default 0,
  add column if not exists last_dispatch_attempt_at timestamptz;

create index if not exists idx_orders_dispatch_retry
  on public.orders (status, delivery_type, rider_id)
  where status = 'ready' and rider_id is null;
