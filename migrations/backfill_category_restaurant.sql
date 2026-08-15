-- Backfill restaurant_id on categories created before categories were
-- scoped to a restaurant (legacy rows have restaurant_id = null).
--
-- A category belongs to the restaurant(s) whose menu items reference it.
-- Categories referenced by items from multiple restaurants get that set of
-- restaurants. Categories referenced by no items at all stay null (visible
-- only to admins/global browsing, not to owners).
-- Run this against your Supabase project (SQL editor) once.

create table if not exists public.category_restaurant_links (
  category_id uuid not null references public.categories(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  primary key (category_id, restaurant_id)
);

insert into public.category_restaurant_links (category_id, restaurant_id)
select distinct mi.category_id, mi.restaurant_id
from public.menu_items mi
where mi.category_id is not null
  and mi.restaurant_id is not null
on conflict (category_id, restaurant_id) do nothing;

-- Single-restaurant categories can be set directly on the row.
update public.categories c
set restaurant_id = l.restaurant_id
from (
  select category_id, min(restaurant_id::text)::uuid as restaurant_id
  from public.category_restaurant_links
  group by category_id
  having count(distinct restaurant_id) = 1
) l
where c.id = l.category_id
  and c.restaurant_id is null;

drop table public.category_restaurant_links;
