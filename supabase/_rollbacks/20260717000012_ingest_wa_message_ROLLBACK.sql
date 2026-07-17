-- Rollback da 20260717000012_ingest_wa_message
-- Seguro se a edge wa-inbound não estiver recebendo webhook de nenhuma instância
-- (estado pré-canário) — senão a ingestão da(s) clínica(s) canário PARA.
DROP FUNCTION IF EXISTS public.ingest_wa_message(text, text, text, text, text, text, text);
