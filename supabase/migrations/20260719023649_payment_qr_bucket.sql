-- 20260719023649_payment_qr_bucket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

insert into storage.buckets (id, name, public)
values ('payment-qr', 'payment-qr', true)
on conflict (id) do nothing;

drop policy if exists "payment_qr_insert" on storage.objects;
create policy "payment_qr_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-qr' and public.can_access_clinic_media_text((storage.foldername(name))[1]));

drop policy if exists "payment_qr_update" on storage.objects;
create policy "payment_qr_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'payment-qr' and public.can_access_clinic_media_text((storage.foldername(name))[1]))
  with check (bucket_id = 'payment-qr' and public.can_access_clinic_media_text((storage.foldername(name))[1]));

drop policy if exists "payment_qr_delete" on storage.objects;
create policy "payment_qr_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-qr' and public.can_access_clinic_media_text((storage.foldername(name))[1]));

drop policy if exists "payment_qr_read" on storage.objects;
create policy "payment_qr_read" on storage.objects
  for select to public
  using (bucket_id = 'payment-qr');
