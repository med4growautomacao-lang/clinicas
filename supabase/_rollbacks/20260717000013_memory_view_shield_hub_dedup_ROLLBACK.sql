-- Rollback da 20260717000013_memory_view_shield_hub_dedup
-- Remove o trigger/função; a view volta a ser auto-atualizável pura (insert da
-- memória grava sempre — o turno humano volta a duplicar em clínicas no hub).
DROP TRIGGER IF EXISTS trg_vw_n8n_chat_memory_insert ON public.vw_n8n_chat_memory;
DROP FUNCTION IF EXISTS public.fn_memory_insert_shield();
