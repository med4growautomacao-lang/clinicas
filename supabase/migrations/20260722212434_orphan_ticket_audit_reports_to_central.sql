-- 20260722212434_orphan_ticket_audit_reports_to_central
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Rede de segurança permanente: se um ticket voltar a nascer sem lead, aparece na Central de
-- Erros (não só numa tabela interna). Órfão é invisível por natureza — some do Kanban e fica
-- fora de todo painel, porque v_kpi_wins e as demais views fazem INNER JOIN com leads.
-- PG_CONTEXT guarda a pilha PL/pgSQL, que identifica a função responsável.
create or replace function public.fn_audit_orphan_ticket()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_ctx text;
begin
  if NEW.lead_id is not null then
    return NEW;
  end if;
  begin
    get diagnostics v_ctx = pg_context;
  exception when others then
    v_ctx := null;
  end;

  insert into public._ticket_orphan_audit
    (ticket_id, clinic_id, stage_id, db_user, app_name, query_atual, pilha)
  values
    (NEW.id, NEW.clinic_id, NEW.stage_id, current_user,
     current_setting('application_name', true), left(current_query(), 2000), v_ctx);

  begin
    perform log_system_error(
      'tickets', 'TICKET_SEM_LEAD',
      'Ticket criado sem lead — some do Kanban e não entra em painel nenhum',
      'error', NEW.clinic_id,
      jsonb_build_object('ticket_id', NEW.id, 'stage_id', NEW.stage_id,
                         'query', left(current_query(), 500), 'pilha', left(coalesce(v_ctx,''), 500)),
      false
    );
  exception when others then null;  -- auditoria nunca pode derrubar a operação
  end;

  return NEW;
end;
$$;
