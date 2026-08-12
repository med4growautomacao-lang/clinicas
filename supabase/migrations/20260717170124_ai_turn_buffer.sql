-- 20260717170124_ai_turn_buffer
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- Buffer de turno da IA (substitui o Redis/Upstash no debounce do Agente IA)
--
-- Modelo: trailing debounce "última mensagem vence". Cada mensagem faz UPSERT
-- (append no buffer + assume o turn_marker); após a espera, o dono reivindica
-- com DELETE ... WHERE turn_marker = <meu> RETURNING — atômico: se uma mensagem
-- mais nova chegou, o marker mudou e o DELETE pega 0 linhas (turno aborta).
-- wait_seconds fica gravado para o futuro modelo despachante (pg_cron) — hoje
-- é informativo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_turn_buffer (
  session_id   text PRIMARY KEY,
  clinic_id    text,
  buffer       text NOT NULL,
  turn_marker  text NOT NULL,
  wait_seconds int,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Sem policies: acesso só por conexão direta (n8n) / service role. PostgREST negado.
ALTER TABLE public.ai_turn_buffer ENABLE ROW LEVEL SECURITY;

-- Limpeza diária de buffers abandonados (execução que morreu entre append e claim)
DO $$
BEGIN
  PERFORM cron.schedule('ai_turn_buffer_cleanup', '23 3 * * *',
    $sql$DELETE FROM public.ai_turn_buffer WHERE updated_at < now() - interval '1 day'$sql$);
EXCEPTION WHEN OTHERS THEN NULL; -- job já existe
END $$;
