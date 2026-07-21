-- =============================================================================
-- IA Analista de Conversas — bootstrap na ativação + "Analisar agora"
--
-- 1) conv_ai_set_enabled: ligar a análise passa a JÁ montar o manual da clínica
--    a partir das conversas existentes, em vez de esperar o job da madrugada.
--    Sem isso a clínica passa até 24h sendo analisada sem manual — exatamente a
--    diferença entre a análise que confundiu agendamento com venda na Vaz e a
--    que acertou depois de existir manual.
--
-- 2) conv_ai_request_analysis: o "Analisar agora". Enfileira até 50 atendimentos
--    abertos com conversa nas últimas 48h (com last_message_at já vencido, para
--    furar o debounce: o pedido foi explícito) e chama a edge na hora via
--    system_http_post — nunca net.http_post cru.
--
--    Cooldown de 2 min, guardado em last_manual_run_at. É MENOR que o ciclo do
--    cron (5 min) de propósito: um botão mais lento que o automático não teria
--    razão de existir. O teto diário por clínica continua valendo.
-- =============================================================================

ALTER TABLE public.conv_ai_clinic_config
  ADD COLUMN IF NOT EXISTS last_manual_run_at timestamptz;
-- corpo das duas funções: idêntico ao aplicado via MCP em 21/07
