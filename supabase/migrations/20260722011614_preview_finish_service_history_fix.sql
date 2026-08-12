-- 20260722011614_preview_finish_service_history_fix
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O histórico do Encerramento (Atendimento) contava TODO ticket fechado nos últimos 7 dias, mas o
-- evento 'service' só ocorre quando o status vira closed SEM mudança de outcome. finalize_ticket
-- grava outcome e fechamento no mesmo statement (outcome_at = closed_at) e dispara ganho/perdido.
-- Medido: 92 fechados em 7 dias, dos quais só 11 são 'service' de verdade (8x de exagero).
do $mig$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'preview_followup_activation' and pronamespace = 'public'::regnamespace;

  if position('outcome_at is distinct from t.closed_at' in src) = 0 then
    src := replace(
      src,
      $old$or (p_kind = 'finish_service' and t.status  = 'closed'  and t.closed_at  >= now() - interval '7 days')$old$,
      $new$or (p_kind = 'finish_service' and t.status = 'closed'
             and t.closed_at >= now() - interval '7 days'
             and (t.outcome is null or t.outcome_at is distinct from t.closed_at))$new$
    );
    execute src;
  end if;
end $mig$;
