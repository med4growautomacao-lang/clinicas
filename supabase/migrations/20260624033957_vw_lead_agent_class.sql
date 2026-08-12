-- 20260624033957_vw_lead_agent_class
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE VIEW public.vw_lead_agent_class AS
SELECT
  cm.clinic_id,
  cm.lead_id,
  CASE
    WHEN COUNT(*) FILTER (WHERE cm.sender = 'ai')
       + COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') = 0
      THEN 'nao_atendido'
    WHEN COUNT(*) FILTER (WHERE cm.sender = 'ai')
       >= COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound')
      THEN 'ia'
    ELSE 'humano'
  END AS agent
FROM public.chat_messages cm
WHERE cm.lead_id IS NOT NULL
GROUP BY cm.clinic_id, cm.lead_id;
