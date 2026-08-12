-- 20260729020921_clinics_has_whatsapp_flag
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Marca comercial: o cliente TEM (ou não) o canal WhatsApp conosco.
--
-- Por que não entrou no mesmo formato de meta_status/google_status/site_status/forms_status
-- (none/inactive/active): ali o "ativo/inativo" é digitado na mão porque não temos como saber.
-- No WhatsApp o ativo/inativo já é REAL e em tempo real (whatsapp_instances.status, alimentado
-- pelo webhook da uazapi). Um terceiro estado manual duplicaria a verdade e envelheceria: a tela
-- diria "Ativo" com o aparelho fora do ar. Então aqui só existe o que faltava — o "Não tem".
--
-- Efeitos de has_whatsapp = false (nesta ordem de importância):
--   1. o chip WhatsApp some da coluna Integrações e o cliente sai do filtro "WhatsApp inativo";
--   2. whatsapp-orchestrator recusa o action 'start' (vale para a tela de Configurações E para o
--      link público /connect?token=…, que não passa por tela nenhuma);
--   3. a faixa global "WhatsApp desconectado / Reconectar" não aparece para o cliente.
--
-- Default true: ninguém muda de comportamento hoje. Só sai do fluxo quem for marcado na mão.
alter table public.clinics
  add column if not exists has_whatsapp boolean not null default true;

comment on column public.clinics.has_whatsapp is
  'Cliente possui o canal WhatsApp conosco. false = some do painel de integrações, não libera conexão (whatsapp-orchestrator recusa o start) e não exibe a faixa de reconexão. O ativo/inativo continua vindo de whatsapp_instances.status, nunca daqui.';
