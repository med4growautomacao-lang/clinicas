-- CAUSA-RAIZ DOS TICKETS ÓRFÃOS (investigação 22/07)
--
-- Sintoma: tickets com lead_id NULL nascendo continuamente (68 só na Gheller). Eles somem do
-- Kanban e ficam fora de TODO painel — v_kpi_wins e as demais views canônicas fazem INNER JOIN
-- com leads. Pior: a invariante uq_tickets_one_open_per_lead é
--     UNIQUE (lead_id) WHERE status='open' AND lead_id IS NOT NULL
-- ou seja, o órfão escapa da trava de "1 ticket aberto por lead" e vários coexistem.
--
-- Foram TRÊS origens, fechadas em sequência:
--   1. Botão "Excluir" do card chamava remove() de useLeads → apagava o LEAD; como
--      tickets.lead_id é ON DELETE SET NULL, todos os tickets da pessoa órfanavam de uma vez.
--      (corrigido no front + migration 20260722000003)
--   2. set_ticket_stage / fn_auto_move_lead_to_agendado, no caminho "novo ciclo", copiavam
--      v_ticket.lead_id do ticket de origem: órfão gerava órfão a cada gatilho de etapa.
--      (migrations 20260722000004 e esta)
--   3. ESTA, a fonte contínua: o cron `delete_pending_leads` (a cada 10 min, ativo desde 20/04)
--      rodava DELETE direto na tabela:
--          DELETE FROM leads WHERE name ILIKE 'Lead Pendente%' AND created_at < now() - '10 min'
--      O placeholder "Lead Pendente" recebe ticket (fn_auto_open_ticket / trg_auto_open_ticket_forms)
--      antes de ser mesclado ao lead real. Quando o cron passava, o lead sumia e o ticket ficava
--      órfão — e o CASCADE de leads ainda levava chat_messages e lead_touchpoints junto.
--      O histórico do cron mostrava DELETE 1-2 a cada passagem, batendo com a taxa de órfãos.
--
-- Verificado: as demais funções que inserem em tickets (fn_auto_open_ticket,
-- fn_auto_open_ticket_forms, fn_auto_link_ticket_on_appointment, fn_resolve_patient_lead_ticket,
-- fn_auto_create_lead_on_patient) já protegem contra lead_id nulo, e fn_apply_stage_rules usa
-- set_ticket_stage com p_on_resolved='block' (não abre ticket novo).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Purga segura: dependentes ANTES do lead, e placeholder com CONVERSA nunca é apagado.
create or replace function public.fn_purge_pending_leads()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids        uuid[];
  v_com_ticket int := 0;
  v_com_msg    int := 0;
  v_tickets    int := 0;
  v_leads      int := 0;
begin
  select array_agg(id) into v_ids
  from leads
  where name ilike 'Lead Pendente%'
    and created_at < now() - interval '10 minutes';

  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('leads', 0, 'tickets', 0);
  end if;

  select count(distinct t.lead_id) into v_com_ticket from tickets t where t.lead_id = any(v_ids);
  select count(distinct m.lead_id) into v_com_msg   from chat_messages m where m.lead_id = any(v_ids);

  -- Placeholder com conversa NÃO é placeholder: alguém real escreveu. Apagar levaria a conversa
  -- junto (chat_messages.lead_id é CASCADE), então esses ficam e viram caso para revisão humana.
  if v_com_msg > 0 then
    perform log_system_error(
      'pending_leads', 'PENDING_LEAD_COM_CONVERSA',
      'Lead Pendente com conversa não foi purgado — verificar por que o placeholder não foi mesclado',
      'warning', null,
      jsonb_build_object('leads_com_conversa', v_com_msg, 'total_candidatos', array_length(v_ids,1)),
      false
    );
    v_ids := array(
      select id from unnest(v_ids) id
      where not exists (select 1 from chat_messages m where m.lead_id = id)
    );
    if array_length(v_ids, 1) is null then
      return jsonb_build_object('leads', 0, 'tickets', 0, 'preservados_com_conversa', v_com_msg);
    end if;
  end if;

  delete from tickets where lead_id = any(v_ids);   -- ANTES do lead: é isso que evita o órfão
  get diagnostics v_tickets = row_count;

  delete from leads where id = any(v_ids);
  get diagnostics v_leads = row_count;

  if v_com_ticket > 0 then
    perform log_system_error(
      'pending_leads', 'PENDING_LEAD_TINHA_TICKET',
      'Lead Pendente purgado já tinha ticket aberto — antes isso virava ticket órfão no Kanban',
      'warning', null,
      jsonb_build_object('leads_com_ticket', v_com_ticket, 'tickets_removidos', v_tickets),
      false
    );
  end if;

  return jsonb_build_object('leads', v_leads, 'tickets', v_tickets,
                            'preservados_com_conversa', v_com_msg);
end;
$$;

revoke all on function public.fn_purge_pending_leads() from public, anon, authenticated;

-- Cron passa a chamar a função em vez do DELETE cru:
--   select cron.alter_job(4, command => 'SELECT public.fn_purge_pending_leads();');

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Rede de segurança: ticket nascendo sem lead vira alerta na Central (antes era invisível).
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
    get diagnostics v_ctx = pg_context;   -- pilha PL/pgSQL: identifica a função responsável
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

drop trigger if exists trg_audit_orphan_ticket on public.tickets;
create trigger trg_audit_orphan_ticket
  before insert on public.tickets
  for each row execute function public.fn_audit_orphan_ticket();
