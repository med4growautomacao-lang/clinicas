-- SANDBOX (ambiente de teste do agente). Injeta no MESMO pipeline nativo: escreve a mensagem do
-- "paciente" (inbound) em chat_messages e enfileira o turno via enqueue_ai_turn, exatamente como o
-- ai-agent faz. O agente processa de verdade (tools reais, criando dados MARCADOS is_simulation) e
-- a resposta sai pela fila roteada p/ transport='sandbox' (nunca toca a uazapi). O purge limpa tudo.
--
-- Telefone ficticio deterministico por (clinica,usuario): '5500' + 8 digitos do hash. DDD 00 nao
-- existe em numero real -> nao colide com uq_leads_normalized_phone. 12 digitos -> normalize_br_phone
-- e idempotente (o strip do 9o digito so age em 13).

create or replace function public._sandbox_phone(p_clinic_id uuid, p_user_id uuid)
returns text language sql immutable
as $$
  select '5500' || lpad(((('x'||substr(md5(p_clinic_id::text||coalesce(p_user_id::text,'')),1,7))::bit(28)::bigint) % 100000000)::text, 8, '0');
$$;

-- Envia uma mensagem do "paciente" e dispara o turno do agente.
create or replace function public.sandbox_send(
  p_clinic_id uuid, p_user_id uuid, p_user_name text, p_text text, p_midia_type text default ''
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_lead_id uuid; v_phone text; v_clinic_phone text; v_token text;
  v_handoff_enabled boolean; v_handoff_rules jsonb; v_transition_rules jsonb; v_confirm boolean;
  v_session text;
begin
  if p_clinic_id is null or coalesce(btrim(p_text),'') = '' then
    raise exception 'sandbox_send: clinic_id e texto sao obrigatorios';
  end if;

  v_phone := public._sandbox_phone(p_clinic_id, p_user_id);

  select id into v_lead_id from leads
   where clinic_id = p_clinic_id and phone = v_phone and coalesce(is_simulation,false);
  if v_lead_id is null then
    insert into leads (clinic_id, name, phone, is_simulation, ai_enabled, followup_enabled)
    values (p_clinic_id, '🧪 Sandbox' || coalesce(' — '||nullif(btrim(p_user_name),''),''), v_phone, true, true, false)
    returning id into v_lead_id;
  end if;

  select handoff_enabled, handoff_rules, transition_rules, confirm_native_enabled
    into v_handoff_enabled, v_handoff_rules, v_transition_rules, v_confirm
    from ai_config where clinic_id = p_clinic_id;

  select phone_number, api_token into v_clinic_phone, v_token
    from whatsapp_instances where clinic_id = p_clinic_id
    order by (status = 'connected') desc nulls last limit 1;
  v_clinic_phone := coalesce(nullif(v_clinic_phone,''), 'sandbox');
  v_session := v_clinic_phone || v_phone;

  -- mensagem do "paciente" -> UI + memoria do agente
  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, session_id, message)
  values (p_clinic_id, v_lead_id, v_phone, 'inbound', 'human', v_session,
          jsonb_build_object('type','human','content', p_text));

  -- dispara o turno (wait=1: no sandbox nao esperamos o debounce longo)
  perform enqueue_ai_turn(
    v_session, p_clinic_id::text, p_text, 1,
    jsonb_build_object(
      'token', v_token, 'contact_identifier', v_phone, 'lead_phone', v_phone,
      'clinic_phone', v_clinic_phone, 'lead_id', v_lead_id,
      'handoff_enabled', coalesce(v_handoff_enabled,false),
      'handoff_rules', coalesce(v_handoff_rules,'[]'::jsonb),
      'transition_rules', coalesce(v_transition_rules,'[]'::jsonb),
      'confirm_enabled', coalesce(v_confirm,false),
      'midia_type', coalesce(p_midia_type,'')
    )
  );

  return jsonb_build_object('lead_id', v_lead_id, 'session_id', v_session, 'phone', v_phone);
end $$;

-- Purga a sessao de simulacao. Cancela/remove agendamentos PRIMEIRO (libera o horario do medico —
-- tickets.lead_id e SET NULL, entao nao da pra confiar em cascade). Opcionalmente apaga o lead.
create or replace function public.sandbox_reset(
  p_clinic_id uuid, p_user_id uuid, p_delete_lead boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_lead_id uuid; v_phone text; v_appts int := 0;
begin
  v_phone := public._sandbox_phone(p_clinic_id, p_user_id);
  select id into v_lead_id from leads
   where clinic_id = p_clinic_id and phone = v_phone and coalesce(is_simulation,false);
  if v_lead_id is null then return jsonb_build_object('ok', true, 'nada_a_limpar', true); end if;

  delete from appointments a using tickets t
   where t.id = a.ticket_id and t.lead_id = v_lead_id;
  get diagnostics v_appts = row_count;

  delete from conversions where lead_id = v_lead_id;
  delete from ai_turn_buffer where session_id like '%' || v_phone;
  delete from outbound_messages where lead_id = v_lead_id;
  delete from chat_messages where lead_id = v_lead_id;
  delete from tickets where lead_id = v_lead_id;

  if p_delete_lead then
    delete from patients where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_phone;
    delete from leads where id = v_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id,
                            'agendamentos_removidos', v_appts, 'lead_apagado', p_delete_lead);
end $$;

revoke all on function public.sandbox_send(uuid,uuid,text,text,text) from anon, authenticated;
revoke all on function public.sandbox_reset(uuid,uuid,boolean) from anon, authenticated;
