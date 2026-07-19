-- Rollback de 20260718000030_prepayment_foundation.sql
drop trigger if exists trg_payments_touch on public.payments;
drop function if exists public.fn_payments_touch_updated_at();
drop table if exists public.payments;
alter table public.ai_config
  drop column if exists payment_enabled,
  drop column if exists payment_pix_key,
  drop column if exists payment_pix_name,
  drop column if exists payment_pix_bank,
  drop column if exists payment_qr_url,
  drop column if exists payment_card_link,
  drop column if exists payment_instructions;
alter table public.consultation_types
  drop column if exists requires_prepayment,
  drop column if exists prepayment_amount;
