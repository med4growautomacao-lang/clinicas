-- 20260408160045_add_last_activity_at_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Reverter fn_update_lead_last_message para somente inbound
CREATE OR REPLACE FUNCTION public.fn_update_lead_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.direction = 'inbound' THEN
    UPDATE public.leads
      SET last_message_at = NEW.created_at
      WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Nova coluna: última atividade (qualquer mensagem)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- Preencher existentes com a última mensagem de qualquer direção
UPDATE public.leads l
SET last_activity_at = (
  SELECT MAX(created_at) FROM public.chat_messages m WHERE m.lead_id = l.id
);

-- Função para atualizar last_activity_at
CREATE OR REPLACE FUNCTION public.fn_update_lead_last_activity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
      SET last_activity_at = NEW.created_at
      WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger para last_activity_at
DROP TRIGGER IF EXISTS trg_update_lead_last_activity ON public.chat_messages;
CREATE TRIGGER trg_update_lead_last_activity
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_lead_last_activity();
