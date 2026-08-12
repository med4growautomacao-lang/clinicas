-- Bucket público para o QR Code do PIX (upload direto pela clínica; a IA envia a URL pública).
-- Escrita restrita a membros da clínica (path[1] = clinic_id), com cast GUARDADO via
-- can_access_clinic_media_text (mesmo padrão seguro da RLS de chat-media — não quebra outros buckets).

insert into storage.buckets (id, name, public)
values ('payment-qr', 'payment-qr', true)
on conflict (id) do nothing;

-- INSERT / UPDATE / DELETE: só quem pode acessar a clínica dona da pasta
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

-- SELECT: bucket é público (a URL pública já funciona sem RLS); policy só p/ o app listar/ler.
drop policy if exists "payment_qr_read" on storage.objects;
create policy "payment_qr_read" on storage.objects
  for select to public
  using (bucket_id = 'payment-qr');
