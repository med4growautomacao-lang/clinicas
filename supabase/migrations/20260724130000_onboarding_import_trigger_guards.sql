-- Onboarding / etapa Sincronização — "modo importação silenciosa".
--
-- Durante a importação de histórico (a sessão liga app.onboarding_import='on'),
-- os gatilhos de chat_messages que ENVIAM, MOVEM CARD, ENFILEIRAM IA ou MEXEM EM
-- ATRIBUIÇÃO não devem disparar (mensagem histórica não é evento ao vivo).
--
-- Técnica: estende (ou adiciona) a cláusula WHEN de cada gatilho com a guarda
--   AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
-- Fora da importação a flag está ausente -> a guarda é sempre verdadeira ->
-- comportamento IDÊNTICO ao atual. NÃO altera o corpo de nenhuma função.
-- A ordem de disparo (alfabética por nome) é preservada: os nomes não mudam.
--
-- ⚠️ MANUTENÇÃO: todo gatilho NOVO em chat_messages que envie/mova/atribua/enfileire
-- precisa respeitar esta mesma guarda, senão volta a vazar na importação.

-- 1) Regras de etapa por keyword (movia o card)
DROP TRIGGER IF EXISTS trg_zz_apply_stage_rules ON public.chat_messages;
CREATE TRIGGER trg_zz_apply_stage_rules AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (
    (new.direction = 'outbound'::text)
    AND (new.sender IS DISTINCT FROM 'ai'::text)
    AND (new.sender IS DISTINCT FROM 'system'::text)
    AND (new.lead_id IS NOT NULL)
    AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  )
  EXECUTE FUNCTION fn_apply_stage_rules();

-- 2) Resposta de confirmação de consulta (podia responder/enviar)
DROP TRIGGER IF EXISTS trg_confirmation_reply ON public.chat_messages;
CREATE TRIGGER trg_confirmation_reply AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (
    (new.direction = 'inbound'::text)
    AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  )
  EXECUTE FUNCTION fn_handle_confirmation_reply();

-- 3) Handoff quando humano responde (pausava IA + notificava)
DROP TRIGGER IF EXISTS trg_handoff_on_human_reply ON public.chat_messages;
CREATE TRIGGER trg_handoff_on_human_reply AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (
    (new.direction = 'outbound'::text)
    AND (new.sender = 'human'::text)
    AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  )
  EXECUTE FUNCTION fn_handoff_on_human_reply();

-- 4) Notificação de comprovante (mandava aviso ao grupo)
DROP TRIGGER IF EXISTS trg_notify_comprovante ON public.chat_messages;
CREATE TRIGGER trg_notify_comprovante AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (
    (new.direction = 'inbound'::text)
    AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  )
  EXECUTE FUNCTION fn_notify_comprovante();

-- 5) Enfileiramento do analista de IA (gerava jobs de LLM)
DROP TRIGGER IF EXISTS trg_zz_conv_ai_enqueue ON public.chat_messages;
CREATE TRIGGER trg_zz_conv_ai_enqueue AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (
    (new.lead_id IS NOT NULL)
    AND (new.sender IS DISTINCT FROM 'system'::text)
    AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  )
  EXECUTE FUNCTION fn_conv_ai_enqueue();

-- 6) Forms/Sincronização -> WhatsApp em inbound (TIRAVA o card da Sincronização!)
--    (não tinha WHEN; a guarda vira a cláusula WHEN)
DROP TRIGGER IF EXISTS trg_move_forms_to_whatsapp ON public.chat_messages;
CREATE TRIGGER trg_move_forms_to_whatsapp AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  EXECUTE FUNCTION fn_move_forms_to_whatsapp_on_inbound();

-- 7) Link session -> lead (atribuição por [Protocolo ####])
DROP TRIGGER IF EXISTS trg_apply_link_session ON public.chat_messages;
CREATE TRIGGER trg_apply_link_session AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  EXECUTE FUNCTION apply_link_session_to_lead();

-- 8) Fechar protocolo de redirecionamento (atribuição)
DROP TRIGGER IF EXISTS trg_close_redirect_protocol ON public.chat_messages;
CREATE TRIGGER trg_close_redirect_protocol AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  EXECUTE FUNCTION fn_close_redirect_protocol();

-- 9) Fechar protocolo do site (atribuição / adoção de rast_id)
DROP TRIGGER IF EXISTS trg_close_site_protocol ON public.chat_messages;
CREATE TRIGGER trg_close_site_protocol AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  EXECUTE FUNCTION fn_close_site_protocol();
