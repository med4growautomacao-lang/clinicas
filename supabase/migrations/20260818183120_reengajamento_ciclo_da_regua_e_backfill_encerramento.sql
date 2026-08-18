-- (1) CICLO DA RÉGUA: identificador determinístico de "esta rodada da cadência".
--
-- A chave anti-duplicidade do Emissor precisa de algo que mude entre rodadas (senão o passo 1 de
-- duas réguas colide e a mensagem some marcada como enviada), mas que NÃO mude entre tentativas
-- da mesma rodada (senão o retry reenvia as bolhas que já saíram). O followup_sent_at, usado até
-- agora, resolvia o primeiro e quebrava o segundo: numa falha parcial (bolha 3 de 3), o release
-- devolvia o passo e a tentativa seguinte gerava chaves novas para as bolhas 1 e 2, que o contato
-- receberia duas vezes.
--
-- O ciclo incrementa só quando a régua RECOMEÇA (p_expected = 0), que é exatamente a fronteira
-- entre rodadas.
alter table public.leads add column if not exists followup_cycle integer not null default 0;

comment on column public.leads.followup_cycle is
  'Rodada atual da régua de reengajamento. Incrementa quando a cadência recomeça (troca de régua ou reinício). Entra na chave anti-duplicidade do Emissor: estável dentro da rodada, diferente entre rodadas.';

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
  v_cycle int;
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
         followup_ruleset_stage_id = p_stage_id,
         -- rodada nova só quando a régua recomeça
         followup_cycle            = case when p_expected = 0 then coalesce(l.followup_cycle, 0) + 1
                                          else coalesce(l.followup_cycle, 0) end
   where l.id = p_lead_id
     and l.followup_enabled = true
     and l.ai_enabled = true
     and l.handoff_triggered_at is null
     and l.converted_patient_id is null
     and not exists (select 1 from public.lead_followup_optout o
                      where o.lead_id = l.id and o.kind = 'reengagement')
     and (
          (l.followup_ruleset_stage_id is not distinct from p_stage_id and l.followup_count = p_expected)
       or (l.followup_ruleset_stage_id is distinct from p_stage_id     and p_expected = 0)
     )
  returning l.followup_sent_at, l.followup_cycle into v_new_sent, v_cycle;

  get diagnostics v_ok = row_count;

  return jsonb_build_object(
    'claimed', v_ok = 1,
    'reason', case when v_ok = 1 then null else 'not_claimed' end,
    'prev_count', v_prev_count,
    'prev_stage_id', v_prev_stage,
    'prev_sent_at', v_prev_sent,
    'sent_at', v_new_sent,
    'cycle', v_cycle);
end;
$function$;

revoke all on function public.fn_claim_reengagement_step(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.fn_claim_reengagement_step(uuid, uuid, int) to service_role;

-- (2) BACKFILL do encerramento para as clínicas que NUNCA tiveram despedida.
--
-- Idempotente e complementar ao backfill da migration 20260818163425 (que rodou antes, aplicada
-- por outra sessão, e já gravou a linha de cada clínica com bool_or(is_closing)). Mantido para
-- que um ambiente novo fique correto mesmo se a ordem mudar: o `on conflict do nothing` faz
-- deste um no-op quando a linha já existe.
insert into public.followup_rulesets (clinic_id, stage_id, close_ticket_on_exhaust)
select distinct s.clinic_id, null::uuid, false
  from public.followup_steps s
 where s.stage_id is null
   and not exists (select 1 from public.followup_steps c
                    where c.clinic_id = s.clinic_id and c.stage_id is null and c.is_closing)
   and not exists (select 1 from public.followup_rulesets r
                    where r.clinic_id = s.clinic_id and r.stage_id is null)
on conflict (clinic_id, stage_id) do nothing;
