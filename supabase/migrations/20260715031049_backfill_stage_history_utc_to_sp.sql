-- 20260715031049_backfill_stage_history_utc_to_sp
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Backfill do bug de fuso em lead_stage_history (changed_at gravado em UTC, +3h).
-- Seguro e por-ticket: classifica cada ticket pela sua linha de ABERTURA (old_stage_id IS NULL),
-- ancorada em tickets.opened_at (timestamptz = instante real). Se a abertura está ~+3h à frente do
-- opened_at em SP, o ticket é da era UTC -> desloca TODAS as linhas dele (abertura + mudanças) -3h.
-- NÃO toca: tickets já em SP (linhas gravadas certas), sem opened_at, ou com delta ambíguo.
-- Idempotente: após o shift a abertura vira SP e o ticket sai do conjunto.
WITH utc_tickets AS (
  SELECT h.ticket_id
  FROM public.lead_stage_history h
  JOIN public.tickets t ON t.id = h.ticket_id
  WHERE h.old_stage_id IS NULL
    AND t.opened_at IS NOT NULL
    AND extract(epoch FROM (h.changed_at - (t.opened_at AT TIME ZONE 'America/Sao_Paulo'))) BETWEEN 9000 AND 12600
)
UPDATE public.lead_stage_history h
   SET changed_at = h.changed_at - interval '3 hours'
  FROM utc_tickets u
 WHERE h.ticket_id = u.ticket_id;
