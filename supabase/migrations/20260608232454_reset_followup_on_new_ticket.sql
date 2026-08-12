-- 20260608232454_reset_followup_on_new_ticket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_reset_followup_on_new_ticket()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'open' THEN
    UPDATE public.leads
      SET followup_count       = 0,
          followup_sent_at     = NULL,
          handoff_triggered_at = NULL
      WHERE id = NEW.lead_id
        AND (followup_count <> 0
             OR followup_sent_at IS NOT NULL
             OR handoff_triggered_at IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reset_followup_on_new_ticket ON public.tickets;

CREATE TRIGGER trg_reset_followup_on_new_ticket
  AFTER INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reset_followup_on_new_ticket();

COMMENT ON FUNCTION public.fn_reset_followup_on_new_ticket() IS
  'Ao abrir um ticket novo (status=open), zera followup_count/followup_sent_at e limpa handoff_triggered_at do lead, reiniciando o ciclo de reengajamento.';
