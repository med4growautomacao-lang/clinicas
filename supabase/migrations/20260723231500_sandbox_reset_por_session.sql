-- O purge apagava chat_messages so por lead_id, mas a resposta do agente (saveAiResponse) grava por
-- session_id e as vezes SEM lead_id (o trigger de backfill nao resolve quando a clinica nao tem
-- telefone e o session_id vira 'sandbox'+fone). Resultado: respostas do agente ficavam orfas apos o
-- purge. Passa a apagar tambem por session_id/telefone (o fone ficticio tem DDD 00, nao colide).
create or replace function public.sandbox_reset(
  p_clinic_id uuid, p_user_id uuid, p_delete_lead boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_lead_id uuid; v_phone text; v_appts int := 0;
begin
  v_phone := public._sandbox_phone(p_clinic_id, p_user_id);
  select id into v_lead_id from leads
   where clinic_id = p_clinic_id and phone = v_phone and coalesce(is_simulation,false);

  -- chat_messages: por lead_id E por session/telefone (pega a resposta do agente sem lead_id).
  delete from chat_messages
   where (v_lead_id is not null and lead_id = v_lead_id)
      or session_id like '%' || v_phone
      or phone = v_phone;

  if v_lead_id is null then return jsonb_build_object('ok', true, 'so_conversa_limpa', true); end if;

  delete from appointments a using tickets t
   where t.id = a.ticket_id and t.lead_id = v_lead_id;
  get diagnostics v_appts = row_count;

  delete from conversions where lead_id = v_lead_id;
  delete from ai_turn_buffer where session_id like '%' || v_phone;
  delete from outbound_messages where lead_id = v_lead_id;
  delete from tickets where lead_id = v_lead_id;

  if p_delete_lead then
    delete from patients where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_phone;
    delete from leads where id = v_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id,
                            'agendamentos_removidos', v_appts, 'lead_apagado', p_delete_lead);
end $$;
