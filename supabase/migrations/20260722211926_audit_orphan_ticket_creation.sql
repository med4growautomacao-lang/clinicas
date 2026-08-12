-- 20260722211926_audit_orphan_ticket_creation
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Auditoria forense: quem cria ticket SEM lead?
-- Nenhuma das 8 funções que inserem em tickets deveria produzir lead_id NULL, mas órfãos
-- continuavam nascendo na Gheller depois de fechadas as duas origens conhecidas. PG_CONTEXT
-- dá a pilha PL/pgSQL completa, então o próximo órfão revela sozinho quem o criou.
create table if not exists public._ticket_orphan_audit (
  id           bigserial primary key,
  ticket_id    uuid,
  clinic_id    uuid,
  stage_id     uuid,
  criado_em    timestamptz not null default now(),
  db_user      text,
  app_name     text,
  query_atual  text,
  pilha        text
);

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
    get diagnostics v_ctx = pg_context;   -- pilha de chamadas PL/pgSQL
  exception when others then
    v_ctx := null;
  end;
  insert into public._ticket_orphan_audit
    (ticket_id, clinic_id, stage_id, db_user, app_name, query_atual, pilha)
  values
    (NEW.id, NEW.clinic_id, NEW.stage_id, current_user,
     current_setting('application_name', true), left(current_query(), 2000), v_ctx);
  return NEW;
end;
$$;

-- BEFORE INSERT, depois do trg_set_ticket_lead_phone na ordem alfabética não importa aqui:
-- a auditoria não altera NEW, só registra.
drop trigger if exists trg_audit_orphan_ticket on public.tickets;
create trigger trg_audit_orphan_ticket
  before insert on public.tickets
  for each row execute function public.fn_audit_orphan_ticket();
