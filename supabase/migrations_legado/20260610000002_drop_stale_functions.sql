-- Limpeza de funções/triggers defasados (auditoria 10/06/2026).
--
-- 1) Funções de trigger ÓRFÃS: retornam `trigger` mas não estão ligadas a
--    nenhum trigger, não são chamadas por outra função e o PostgREST não expõe
--    funções `trigger` como RPC → mortas. Foram substituídas:
--      - handle_chat_message_lead_capture / handle_chat_message_logic
--        → handle_chat_message_master_logic (master logic faz a captura);
--      - fn_log_lead_stage_change → fn_log_ticket_stage_change (log por ticket);
--      - fn_set_default_lead_stage → etapa vem do ticket, não do lead.
--
-- 2) tr_sanitize_lead_phone (trigger DESLIGADO) + sanitize_lead_phone_number:
--    desativado de propósito — a normalização do telefone é feita upstream no
--    n8n. Sem refs em funções/crons. Removidos para limpar.

DROP FUNCTION IF EXISTS public.handle_chat_message_lead_capture();
DROP FUNCTION IF EXISTS public.handle_chat_message_logic();
DROP FUNCTION IF EXISTS public.fn_log_lead_stage_change();
DROP FUNCTION IF EXISTS public.fn_set_default_lead_stage();

DROP TRIGGER IF EXISTS tr_sanitize_lead_phone ON public.leads;
DROP FUNCTION IF EXISTS public.sanitize_lead_phone_number();
