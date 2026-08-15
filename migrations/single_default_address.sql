-- Enforce a single default address per user.
--
-- Older code set is_default=true without clearing the previous default, so a
-- user could end up with several "default" addresses (which made the app's
-- header location picker revert to an old location). This migration:
--   1. Keeps only the most recently updated default per user.
--   2. Adds a partial unique index so the data can never drift again.
-- Run this against your Supabase project (SQL editor) once.

-- 1) Clear duplicate defaults: keep the newest default per user.
update public.addresses a
set is_default = false
where a.is_default = true
  and exists (
    select 1
    from public.addresses newer
    where newer.user_id = a.user_id
      and newer.is_default = true
      and (
        newer.updated_at > a.updated_at
        or (newer.updated_at = a.updated_at and newer.id > a.id)
      )
  );

-- 2) Database-level guarantee: at most one default address per user.
create unique index if not exists idx_addresses_single_default
  on public.addresses (user_id)
  where is_default = true;
