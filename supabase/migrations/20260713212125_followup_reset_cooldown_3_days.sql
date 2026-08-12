-- 20260713212125_followup_reset_cooldown_3_days
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create or replace function public.fn_reset_followup_on_new_ticket()
returns trigger
language plpgsql
as $function$
BEGIN
  IF NEW.status = 'open' THEN
    -- Handoff: sempre limpo (ticket novo = atendimento novo). Não participa do loop.
    UPDATE public.leads
      SET handoff_triggered_at = NULL
      WHERE id = NEW.lead_id
        AND handoff_triggered_at IS NOT NULL;

    -- A régua só reinicia após a carência (3 dias). Sem isto, responder ao "vou encerrar" abre
    -- ticket novo, zera o contador e a perseguição recomeça do passo 1 (66 leads afetados; o
    -- "Cleberson" levou 7 mensagens em 3 ciclos).
    UPDATE public.leads
      SET followup_count   = 0,
          followup_sent_at = NULL
      WHERE id = NEW.lead_id
        AND (followup_count <> 0 OR followup_sent_at IS NOT NULL)
        AND (
          followup_sent_at IS NULL
          OR followup_sent_at < ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 days')
        );
  END IF;
  RETURN NEW;
END;
$function$;
