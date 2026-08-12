-- Janela de envio do reengajamento configurável por clínica (hora início/fim, SP).
-- Fora da janela: o lead segue elegível e dispara na próxima janela. Default 6h–22h.
-- (A função do selector é reescrita na migration 20260625000008 com o gate por outbound.)
alter table public.ai_config
  add column if not exists followup_window_start int not null default 6,
  add column if not exists followup_window_end   int not null default 22;

comment on column public.ai_config.followup_window_start is 'Hora (0-23, SP) de início da janela de envio do reengajamento.';
comment on column public.ai_config.followup_window_end   is 'Hora (0-23, SP) de fim (exclusiva) da janela de envio do reengajamento.';
