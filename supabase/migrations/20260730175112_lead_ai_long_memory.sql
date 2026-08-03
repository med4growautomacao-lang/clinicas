-- Memoria LONGA do Agente IA, por lead.
--
-- Repoe o sub-workflow n8n "Chat Memory Agente IA" (LEAD MEMORY ORGANIZER), que morreu na migracao
-- para o nativo e nunca foi substituido. Sem ele o agente so tem a janela curta de conversa
-- (MEMORY_WINDOW=10 linhas): medido em 30/07/2026 na clinica Lorena Barros, a resposta "33" do
-- paciente ficou 1 posicao FORA da janela e 7 minutos depois o agente respondeu "eu ainda nao
-- anotei a sua idade", com o paciente na frente.
--
-- ⚠️ COLUNA PROPRIA, e nao `leads.ai_summary`, de proposito. `ai_summary` ja tem dono: o
-- `conv-ai-analyst` (cron de 5 min) reescreve a coluna inteira quando o analista esta ligado.
-- Dividir a mesma coluna faria os dois se sobrescreverem e a memoria do agente sumiria sozinha,
-- sem erro nenhum. Alem disso a memoria do agente NAO pode depender da chave do analista, que e
-- outro produto: e exatamente por isso que a Lorena Barros estava com 100% dos leads sem memoria
-- (conv_ai_clinic_config.enabled = false).
alter table public.leads add column if not exists ai_long_memory text;

comment on column public.leads.ai_long_memory is
  'Memoria longa do Agente IA (ficha de fatos do contato, markdown). Dono unico: _shared/agent/long-memory.ts, gravada apos cada turno. Injetada no system prompt. NAO confundir com ai_summary, que e do conv-ai-analyst.';
