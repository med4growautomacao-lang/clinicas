-- 20260709030021_drop_save_orcamento_old_overload
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- CREATE OR REPLACE com assinatura diferente (p_ticket_id novo) criou um OVERLOAD em vez de
-- substituir — agora há 2 versões de save_orcamento (16 e 17 params), o que causa erro de
-- "could not choose the best candidate function" na chamada via PostgREST. Derruba a antiga.
DROP FUNCTION IF EXISTS public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb);
