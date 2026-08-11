-- Rider dispatch support (run in Supabase SQL editor)

-- Riders: availability + fairness tracking
alter table public.riders
  add column if not exists online boolean default false,
  add column if not exists reliability_score numeric default 0,
  add column if not exists last_delivered_at timestamptz,
  add column if not exists active_orders integer default 0;

-- Rider location history
create table if not exists public.rider_locations (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  heading double precision,
  speed double precision,
  accuracy double precision,
  created_at timestamptz default now()
);

create index if not exists rider_locations_rider_id_idx on public.rider_locations (rider_id);
create index if not exists rider_locations_created_at_idx on public.rider_locations (created_at);

alter table public.rider_locations enable row level security;

create policy "Riders manage own location" on public.rider_locations
  for all to authenticated
  using (
    exists (
      select 1 from public.riders r
      where r.id = rider_locations.rider_id and r.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.riders r
      where r.id = rider_locations.rider_id and r.user_id = auth.uid()
    )
  );

-- Orders: dispatch bookkeeping
alter table public.orders
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatch_score numeric,
  add column if not exists dispatch_note text;
