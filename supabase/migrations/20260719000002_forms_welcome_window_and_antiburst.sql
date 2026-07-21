-- Janela de envio do welcome: colunas de configuração (default 6h-22h, horário de São Paulo).
--
-- ⚠️ ESTE ARQUIVO SÓ CRIA AS COLUNAS. A versão de process_forms_followup que ele continha
-- originalmente foi REMOVIDA de propósito: a migration 20260719000057_followup_wrongsend_guards
-- (numerada DEPOIS desta) redefine a função com as guardas da auditoria. Se este arquivo ainda
-- redefinisse a função, um replay do zero aplicaria a versão antiga por último e derrubaria as
-- guardas (is_not_lead, WhatsApp connected, send_blocked_until).
--
-- As colunas continuam aqui porque a 057 LÊ ac.welcome_window_start/end e precisa que já existam.

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS welcome_window_start int NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS welcome_window_end   int NOT NULL DEFAULT 22;
