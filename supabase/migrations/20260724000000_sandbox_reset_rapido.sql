-- Acelera o purge do sandbox. A versao anterior apagava chat_messages com `session_id like '%'||fone`
-- (curinga no INICIO), o que NAO usa indice e varria as ~462k linhas da tabela -> reset lento.
-- Agora usa IGUALDADE do session_id (calculado, mesma formula do sandbox_send) + phone: ambos com
-- indice (idx_chat_messages_session_seq, idx_chat_messages_phone, idx_chat_messages_lead_date).
create or replace function public.sandbox_reset(
  p_clinic_id uuid, p_user_id uuid, p_delete_lead boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
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

  if p_delete_lead then
    delete from patients where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_phone;
    delete from leads where id = v_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id,
                            'agendamentos_removidos', v_appts, 'lead_apagado', p_delete_lead);
end $$;
