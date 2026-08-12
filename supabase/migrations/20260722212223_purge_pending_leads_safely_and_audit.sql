-- 20260722212223_purge_pending_leads_safely_and_audit
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ORIGEM DOS TICKETS ÓRFÃOS: o cron delete_pending_leads (a cada 10 min) fazia
--     DELETE FROM leads WHERE name ILIKE 'Lead Pendente%' AND created_at < now() - '10 min'
-- direto na tabela. Como tickets.lead_id é ON DELETE SET NULL, todo ticket já aberto para esse
-- placeholder virava ÓRFÃO — e o CASCADE de leads ainda levava chat_messages/touchpoints junto.
-- O cron roda desde 20/04 e apaga 1-2 leads a cada passagem: é a fonte contínua que sobrou depois
-- de fechadas as duas outras (botão Excluir e new_cycle propagando lead_id nulo).
--
-- Agora a purga é uma função que limpa os DEPENDENTES antes do lead, nunca deixando órfão,
-- e registra na Central quando o placeholder já tinha ticket ou conversa (não deveria ter:
-- indica que o placeholder viveu tempo demais e virou atendimento de verdade).

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

  -- Tickets ANTES do lead: é isso que impedia o órfão.
  delete from tickets where lead_id = any(v_ids);
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
