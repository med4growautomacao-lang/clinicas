-- Rollback de 20260718000032_payment_qr_bucket.sql
drop policy if exists "payment_qr_insert" on storage.objects;
drop policy if exists "payment_qr_update" on storage.objects;
drop policy if exists "payment_qr_delete" on storage.objects;
drop policy if exists "payment_qr_read" on storage.objects;
-- objetos precisam ser removidos antes de apagar o bucket, se houver:
-- delete from storage.objects where bucket_id = 'payment-qr';
delete from storage.buckets where id = 'payment-qr';
