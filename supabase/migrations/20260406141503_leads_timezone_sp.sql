-- 20260406141503_leads_timezone_sp
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Altera a coluna created_at da tabela leads para o fuso horÃ¡rio de SÃ£o Paulo
-- Alterando para TIMESTAMP WITHOUT TIME ZONE para garantir que o valor exibido seja o valor nominal (wall clock) de SP.

DO $$
BEGIN
  -- created_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'created_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN created_at TYPE timestamp without time zone 
      USING created_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  -- updated_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'updated_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN updated_at TYPE timestamp without time zone 
      USING updated_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN updated_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  -- followup_sent_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'followup_sent_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN followup_sent_at TYPE timestamp without time zone 
      USING followup_sent_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN followup_sent_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  -- handoff_triggered_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'handoff_triggered_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN handoff_triggered_at TYPE timestamp without time zone 
      USING handoff_triggered_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN handoff_triggered_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  -- confirm_sent_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'confirm_sent_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN confirm_sent_at TYPE timestamp without time zone 
      USING confirm_sent_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN confirm_sent_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  -- last_message_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'last_message_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN last_message_at TYPE timestamp without time zone 
      USING last_message_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN last_message_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;

  -- last_outbound_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'last_outbound_at') THEN
    ALTER TABLE public.leads 
      ALTER COLUMN last_outbound_at TYPE timestamp without time zone 
      USING last_outbound_at AT TIME ZONE 'America/Sao_Paulo';
    ALTER TABLE public.leads 
      ALTER COLUMN last_outbound_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
  END IF;
END $$;
