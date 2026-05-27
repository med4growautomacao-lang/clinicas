ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS response_wait_seconds integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ai_config.response_wait_seconds
  IS 'Segundos que a IA aguarda recebendo mensagens em rajada antes de elaborar uma resposta. 0 = resposta imediata.';
