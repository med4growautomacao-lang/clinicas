-- Rollback da 20260717000010_ai_turn_buffer
-- ATENÇÃO: só rode depois de restaurar o workflow "Agente IA" para a versão Redis
-- (n8n_workflow_versions rollback), senão o debounce da IA quebra.
DO $$ BEGIN PERFORM cron.unschedule('ai_turn_buffer_cleanup'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DROP TABLE IF EXISTS public.ai_turn_buffer;
