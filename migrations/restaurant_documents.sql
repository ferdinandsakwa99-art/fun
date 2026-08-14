-- Restaurant owner verification (run in Supabase SQL editor)

-- Restaurants: verification documents + submission tracking
alter table public.restaurants
  add column if not exists id_number text,
  add column if not exists id_front_url text,
  add column if not exists id_back_url text,
  add column if not exists documents_submitted_at timestamptz;

-- Storage bucket for uploaded restaurant documents (public read for admin
-- review, write restricted to the owner's own folder by their auth user id).
insert into storage.buckets (id, name, public)
values ('restaurant-documents', 'restaurant-documents', true)
on conflict (id) do nothing;

drop policy if exists "Restaurant upload own documents" on storage.objects;
create policy "Restaurant upload own documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'restaurant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Restaurant update own documents" on storage.objects;
create policy "Restaurant update own documents" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'restaurant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'restaurant-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public read restaurant documents" on storage.objects;
create policy "Public read restaurant documents" on storage.objects
  for select to public
  using (bucket_id = 'restaurant-documents');
