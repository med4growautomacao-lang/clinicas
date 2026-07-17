-- Rollback da 20260717000006_stage_rules_trigger_shadow
-- Remove o trigger de gatilhos, a função, a tabela shadow e o setting de modo.
-- Depois disto, o n8n "Gatilhos" volta a ser a única fonte de movimento por keyword
-- (só reverter enquanto os nós Call Gatilhos do Receptor ainda estiverem ativos).

DROP TRIGGER IF EXISTS trg_zz_apply_stage_rules ON public.chat_messages;
DROP FUNCTION IF EXISTS public.fn_apply_stage_rules();
DROP TABLE IF EXISTS public._shadow_stage_rules;
DELETE FROM public.system_settings WHERE id = 'stage_rules_engine_mode';
