-- Remove overloads redundantes e duplicatas (auditoria 10/06/2026).
--
-- 1) book_appointment(11 args) — BUG real: a edge function ai-scheduler só inclui
--    a chave p_consultation_type_id quando a IA manda o ct_id; no caminho de
--    modalidade (sem ct_id) o conjunto de chaves casa com a 11 E a 12 → PostgREST
--    "function is not unique" → o agendamento falha. A 12-arg cobre 100% da 11
--    (resolve por slug de modalidade no ELSE). Remover a 11 conserta a ambiguidade.
--
-- 2) convert_lead_to_appointment(10 args) — overload antigo; o app sempre manda
--    p_consultation_type_id (casa só com a 11). A 10 nunca é usada.
--
-- 3) create_clinic_with_owner(7 args) — sem call site (app usa a de 6 e a de 8).
--
-- 4) sync_n8n_memory_to_chat — função de trigger órfã (retorna trigger, sem
--    trigger ligado; PostgREST não a expõe como RPC). Substituída por
--    handle_chat_message_master_logic.
--
-- 5) propagate_clinic_name_to_whatsapp — duplicata de sync_clinic_name_to_instance:
--    as duas faziam o MESMO UPDATE em whatsapp_instances.clinic_name no rename da
--    clínica. Mantemos sync_clinic_name_to_instance (consistente com os irmãos
--    sync_clinic_name_to_leads / _chat_messages, todos AFTER UPDATE OF name).

DROP FUNCTION IF EXISTS public.book_appointment(
  uuid, uuid, date, time without time zone, text, text, integer, text, text, text, uuid);

DROP FUNCTION IF EXISTS public.convert_lead_to_appointment(
  uuid, uuid, uuid, date, time without time zone, text, text, uuid, integer, uuid);

DROP FUNCTION IF EXISTS public.create_clinic_with_owner(
  text, text, uuid, text, text, text, text);

DROP FUNCTION IF EXISTS public.sync_n8n_memory_to_chat();

DROP TRIGGER IF EXISTS trg_propagate_clinic_name_whatsapp ON public.clinics;
DROP FUNCTION IF EXISTS public.propagate_clinic_name_to_whatsapp();
