-- "Limpar conversa" do simulador tem que limpar a MEMORIA tambem.
--
-- Ate agora a unica memoria do agente era a janela de conversa, entao apagar `chat_messages` era
-- reset completo. Com a memoria longa (leads.ai_long_memory, migration 20260730175112) isso deixou
-- de ser verdade: o lead de simulacao sobrevive ao reset (p_delete_lead=false e o caso comum, e o
-- que o botao da tela usa), e o agente reencontraria o testador sabendo nome, idade e medicacao de
-- um teste anterior. Sem isto, quem testa conclui que o reset esta quebrado.
--
-- Limpa `ai_summary` junto de proposito: com a memoria longa vazia o prompt cai de volta nele
-- (ver assembleSystemPrompt), entao zerar so uma das duas devolveria a lembranca velha por outra
-- porta. Sao dados de um lead `is_simulation`, nunca de paciente real.
create or replace function public.sandbox_reset(p_clinic_id uuid, p_user_id uuid, p_delete_lead boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
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
  update leads set ai_long_memory = null, ai_summary = null where id = v_lead_id;

  if p_delete_lead then
    delete from patients where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_phone;
    delete from leads where id = v_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id,
                            'agendamentos_removidos', v_appts, 'lead_apagado', p_delete_lead);
end $function$;

-- CLAUDE.md §1: `create ... function` reconcede ao PUBLIC. Revogar de anon so nao basta.
revoke all on function public.sandbox_reset(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.sandbox_reset(uuid, uuid, boolean) to service_role;
