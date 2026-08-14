-- Dedicated platform wallet that holds the platform fee (16% commission)
-- collected from each order sale. Run this against your Supabase project
-- (SQL editor) once.

alter table public.wallets
  add column if not exists is_platform boolean not null default false;

-- Enforce exactly one platform wallet row.
create unique index if not exists wallets_platform_uidx
  on public.wallets ((is_platform))
  where is_platform;

-- Seed the single platform wallet if it does not exist yet.
insert into public.wallets (is_platform, currency, balance)
select true, 'KES', 0
where not exists (select 1 from public.wallets where is_platform);
