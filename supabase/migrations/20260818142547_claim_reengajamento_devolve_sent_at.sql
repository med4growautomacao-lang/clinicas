-- O claim passa a devolver o followup_sent_at que acabou de gravar.
-- É o que dá à edge um identificador de CICLO para a chave anti-duplicidade do Emissor.
-- Sem ciclo na chave, o "passo 1" de uma régua colide com o "passo 1" de outra (ou com o
-- mesmo passo depois de um reinício) e o emit_message devolve o id da linha ANTIGA: o
-- produtor acha que enfileirou, grava 'sent' em automation_logs, e a mensagem nunca sai.
-- Provado em transação revertida: 2 chamadas com a mesma dedup_key => 1 linha, ids iguais.

create or replace function public.fn_claim_reengagement_step(
  p_lead_id uuid, p_stage_id uuid, p_expected int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev_count int;
  v_prev_stage uuid;
  v_prev_sent timestamp;
  v_new_sent timestamp;
  v_ok int;
begin
  select followup_count, followup_ruleset_stage_id, followup_sent_at
    into v_prev_count, v_prev_stage, v_prev_sent
    from public.leads where id = p_lead_id for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'lead_nao_encontrado');
  end if;

  update public.leads l
     set followup_count            = p_expected + 1,
         followup_sent_at          = (now() at time zone 'America/Sao_Paulo'),
         followup_ruleset_stage_id = p_stage_id
   where l.id = p_lead_id
     and l.followup_enabled = true
     and l.ai_enabled = true
     and l.handoff_triggered_at is null
     and l.converted_patient_id is null
     -- fecha a janela conhecida entre listar e enviar: opt-out novo é respeitado aqui
     and not exists (select 1 from public.lead_followup_optout o
                      where o.lead_id = l.id and o.kind = 'reengagement')
     and (
          (l.followup_ruleset_stage_id is not distinct from p_stage_id and l.followup_count = p_expected)
       or (l.followup_ruleset_stage_id is distinct from p_stage_id     and p_expected = 0)
     )
  returning l.followup_sent_at into v_new_sent;

  get diagnostics v_ok = row_count;

  return jsonb_build_object(
    'claimed', v_ok = 1,
    'reason', case when v_ok = 1 then null else 'not_claimed' end,
    'prev_count', v_prev_count,
    'prev_stage_id', v_prev_stage,
    'prev_sent_at', v_prev_sent,
    'sent_at', v_new_sent);
end;
$function$;
