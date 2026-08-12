-- O simulador ("Testar o Agente") passa a reproduzir o SILÊNCIO pós-transferência.
--
-- Problema: depois que a IA é pausada para um contato (TRANSFERIR_PARA_ESPECIALISTA ou
-- ACIONAR_HANDOFF gravam leads.ai_enabled=false), a PRODUÇÃO para de responder — quem barra é o
-- `ingest_wa_message`, com a régua `v_lead.ai_enabled is not false`. O simulador não passava por
-- essa régua: o `sandbox_send` enfileirava o turno de qualquer jeito e o agente continuava
-- conversando. Ou seja, o teste mostrava um comportamento que produção não tem, e o único jeito de
-- conferir o silêncio era olhando a coluna no banco.
--
-- Aqui o sandbox passa a usar EXATAMENTE a mesma régua da produção (`is not false`, e não `= true`:
-- lead com ai_enabled NULL conversa normalmente nos dois lados).
create or replace function public.sandbox_send(
  p_clinic_id uuid, p_user_id uuid, p_user_name text, p_text text, p_midia_type text default ''
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_lead_id uuid; v_phone text; v_clinic_phone text; v_token text;
  v_handoff_enabled boolean; v_handoff_rules jsonb; v_transition_rules jsonb; v_confirm boolean;
  v_session text; v_ia_ligada boolean;
begin
  if p_clinic_id is null or coalesce(btrim(p_text),'') = '' then
    raise exception 'sandbox_send: clinic_id e texto sao obrigatorios';
  end if;

  v_phone := public._sandbox_phone(p_clinic_id, p_user_id);

  select id, ai_enabled into v_lead_id, v_ia_ligada from leads
   where clinic_id = p_clinic_id and phone = v_phone and coalesce(is_simulation,false);
  if v_lead_id is null then
    insert into leads (clinic_id, name, phone, is_simulation, ai_enabled, followup_enabled)
    values (p_clinic_id, '🧪 Sandbox' || coalesce(' — '||nullif(btrim(p_user_name),''),''), v_phone, true, true, false)
    returning id into v_lead_id;
    v_ia_ligada := true;
  end if;

  select handoff_enabled, handoff_rules, transition_rules, confirm_native_enabled
    into v_handoff_enabled, v_handoff_rules, v_transition_rules, v_confirm
    from ai_config where clinic_id = p_clinic_id;

  select phone_number, api_token into v_clinic_phone, v_token
    from whatsapp_instances where clinic_id = p_clinic_id
    order by (status = 'connected') desc nulls last limit 1;
  v_clinic_phone := coalesce(nullif(v_clinic_phone,''), 'sandbox');
  v_session := v_clinic_phone || v_phone;

  -- A mensagem do "paciente" é gravada SEMPRE, mesmo com a IA pausada: quem testa precisa ver o
  -- que digitou, e em produção a mensagem do contato também é persistida antes de qualquer gate.
  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, session_id, message)
  values (p_clinic_id, v_lead_id, v_phone, 'inbound', 'human', v_session,
          jsonb_build_object('type','human','content', p_text));

  -- ⚠️ MESMA RÉGUA DO ingest_wa_message. IA pausada para este contato = turno NÃO é enfileirado, e
  -- o silêncio que o cliente veria em produção aparece aqui também. `ia_pausada` volta para a tela
  -- explicar o silêncio, senão ele viraria "o simulador quebrou".
  if v_ia_ligada is false then
    return jsonb_build_object('lead_id', v_lead_id, 'session_id', v_session, 'phone', v_phone,
                              'ia_pausada', true);
  end if;

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

  return jsonb_build_object('lead_id', v_lead_id, 'session_id', v_session, 'phone', v_phone,
                            'ia_pausada', false);
end $$;

-- O reset volta a IA a ligada. Sem isto, um teste que terminasse em transferência ou transbordo
-- deixava o simulador MUDO para sempre, e o "Reiniciar" da tela não resolvia — porque a memória e a
-- conversa eram limpas, mas a chave que cala o agente ficava de pé no lead.
create or replace function public.sandbox_reset(p_clinic_id uuid, p_user_id uuid, p_delete_lead boolean DEFAULT false)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_lead_id uuid; v_phone text; v_session text; v_clinic_phone text; v_appts int := 0;
begin
  v_phone := public._sandbox_phone(p_clinic_id, p_user_id);
  select phone_number into v_clinic_phone from public.whatsapp_instances
   where clinic_id = p_clinic_id order by (status = 'connected') desc nulls last limit 1;
  v_session := coalesce(nullif(v_clinic_phone,''), 'sandbox') || v_phone;

  select id into v_lead_id from leads
   where clinic_id = p_clinic_id and phone = v_phone and coalesce(is_simulation,false);

  -- Tudo indexado (lead_id / session_id exato / phone): pega o inbound e a resposta do agente (que
  -- grava por session_id e as vezes sem lead_id), sem varrer a tabela inteira.
  delete from chat_messages
   where (v_lead_id is not null and lead_id = v_lead_id)
      or session_id = v_session
      or phone = v_phone;

  if v_lead_id is null then return jsonb_build_object('ok', true, 'so_conversa_limpa', true); end if;

  delete from appointments a using tickets t
   where t.id = a.ticket_id and t.lead_id = v_lead_id;
  get diagnostics v_appts = row_count;

  delete from conversions where lead_id = v_lead_id;
  delete from ai_turn_buffer where session_id = v_session;
  delete from outbound_messages where lead_id = v_lead_id;
  delete from tickets where lead_id = v_lead_id;

  -- ⚠️ A memoria do agente vive no LEAD, nao na conversa: sem esta linha o reset apaga a tela e
  -- deixa a lembranca de pe.
  -- ⚠️ ai_enabled/handoff_triggered_at entram pelo MESMO motivo: eles tambem vivem no lead, e sao
  -- escritos pela transferencia do SDR e pelo transbordo. Sem restaura-los, o "Reiniciar" devolvia
  -- uma tela limpa com o agente mudo, e o sintoma parecia defeito do simulador.
  update leads set ai_long_memory = null, ai_summary = null,
                   ai_enabled = true, handoff_triggered_at = null
   where id = v_lead_id;

  if p_delete_lead then
    delete from patients where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_phone;
    delete from leads where id = v_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id,
                            'agendamentos_removidos', v_appts, 'lead_apagado', p_delete_lead);
end $function$;

-- Os grants seguem a mesma trava de antes: só a edge ai-sandbox (service_role) chama.
revoke all on function public.sandbox_send(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.sandbox_reset(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.sandbox_send(uuid, uuid, text, text, text) to service_role;
grant execute on function public.sandbox_reset(uuid, uuid, boolean) to service_role;