-- View de classificação de agente por lead (IA / Humano / Não atendido),
-- usada pelo filtro de Agente do painel Visão Geral (get_dashboard_stats).
--
-- Regra-base do painel Comercial (maioria de VOLUME de mensagens de saída):
--   ai_out    = nº de mensagens da IA
--   human_out = nº de mensagens humanas de saída (direction = 'outbound')
--   'ia'           se total > 0 e ai_out >= human_out   (empate -> IA)
--   'humano'       se human_out > ai_out
--   'nao_atendido' se não houve nenhuma mensagem de saída
--
-- Obs.: espelha a regra-BASE do Comercial (20260622000003), SEM as refinações
-- posteriores (cutoff no agendamento / booked-no-chat por origem). Logo o split
-- IA/Humano do Visão Geral pode divergir levemente do Comercial — coerente com o
-- fato de os painéis divergirem por construção.
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
