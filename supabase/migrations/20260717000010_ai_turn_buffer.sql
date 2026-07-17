-- =============================================================================
-- Buffer de turno da IA (substitui o Redis/Upstash no debounce do Agente IA)
--
-- Modelo: trailing debounce "última mensagem vence". Cada mensagem faz UPSERT
-- (append no buffer + assume o turn_marker); após a espera, o dono reivindica
-- com DELETE ... WHERE turn_marker = <meu> RETURNING — atômico: se uma mensagem
-- mais nova chegou, o marker mudou e o DELETE pega 0 linhas (turno aborta).
-- Mata em definitivo a race do GET→IF→DEL do Redis (perda de mensagem em rajada).
-- wait_seconds fica gravado para o futuro modelo despachante (pg_cron) — hoje
-- é informativo.
--
-- Consumidor: workflow n8n "Agente IA" (nós messageInsert/getBufferFinal, Postgres,
-- credencial "Supabase | Clinica"). O nome getBufferFinal e o campo bufferFinal
-- são CONTRATO — o AI Agent lê $('getBufferFinal').item.json.bufferFinal.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_turn_buffer (
  session_id   text PRIMARY KEY,
  clinic_id    text,
  buffer       text NOT NULL,
  turn_marker  text NOT NULL,
  wait_seconds int,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_turn_buffer ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  PERFORM cron.schedule('ai_turn_buffer_cleanup', '23 3 * * *',
    $sql$DELETE FROM public.ai_turn_buffer WHERE updated_at < now() - interval '1 day'$sql$);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
