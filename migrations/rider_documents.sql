-- Rider document verification (run in Supabase SQL editor)

-- Riders: verification documents + submission tracking
alter table public.riders
  add column if not exists id_number text,
  add column if not exists selfie_url text,
  add column if not exists id_front_url text,
  add column if not exists id_back_url text,
  add column if not exists good_conduct_url text,
  add column if not exists insurance_url text,
  add column if not exists driving_license_url text,
  add column if not exists documents_submitted_at timestamptz;

-- Storage bucket for uploaded rider documents (public read for admin review,
-- write restricted to the rider's own folder by their auth user id).
insert into storage.buckets (id, name, public)
values ('rider-documents', 'rider-documents', true)
on conflict (id) do nothing;

drop policy if exists "Rider upload own documents" on storage.objects;
create policy "Rider upload own documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'rider-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Rider update own documents" on storage.objects;
create policy "Rider update own documents" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'rider-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'rider-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public read rider documents" on storage.objects;
create policy "Public read rider documents" on storage.objects
  for select to public
  using (bucket_id = 'rider-documents');
