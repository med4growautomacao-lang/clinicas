-- Altera a coluna created_at da tabela leads para o fuso horÃ¡rio de SÃ£o Paulo
-- Alterando para TIMESTAMP WITHOUT TIME ZONE para garantir que o valor exibido seja o valor nominal (wall clock) de SP.

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN created_at TYPE timestamp without time zone 
  USING created_at AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- Ajustando tambÃ©m updated_at para manter a consistÃªncia no funil
ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN updated_at TYPE timestamp without time zone 
  USING updated_at AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN updated_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- Nota: TambÃ©m ajustamos followup_sent_at e last_message_at para nÃ£o haver discrepÃ¢ncias nos relatÃ³rios do kanban
ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN followup_sent_at TYPE timestamp without time zone 
  USING followup_sent_at AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN handoff_triggered_at TYPE timestamp without time zone 
  USING handoff_triggered_at AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN confirm_sent_at TYPE timestamp without time zone 
  USING confirm_sent_at AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN last_message_at TYPE timestamp without time zone 
  USING last_message_at AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE IF EXISTS public.leads 
  ALTER COLUMN last_outbound_at TYPE timestamp without time zone 
  USING last_outbound_at AT TIME ZONE 'America/Sao_Paulo';
