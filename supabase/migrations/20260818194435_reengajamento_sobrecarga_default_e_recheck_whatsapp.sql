-- Correções da terceira revisão (18/08/2026), verificadas no banco antes de aplicar.

-- (1) SOBRECARGA FANTASMA. O `create or replace` com um parâmetro novo NÃO substituiu a função:
-- criou uma segunda, e as duas passaram a coexistir (4 e 5 argumentos). Provado: chamar com 4
-- argumentos devolvia 42725 "function is not unique". Hoje a edge chama com 5 e funciona, mas
-- um rollback da função para a versão anterior deixaria TODO release quebrado — o passo seria
-- consumido sem envio, em silêncio. A antiga sai.
drop function if exists public.fn_release_reengagement_step(uuid, int, uuid, timestamp);

-- (2) DEFAULT DA COLUNA acompanha a regra nova. O selector já lê ausência como "não encerrar",
-- mas a coluna continuava `default true` e o comentário do banco dizia o contrário — e neste
-- projeto quem lê a regra lê o comentário no banco, não a migration. Qualquer insert futuro que
-- omitisse a coluna (onboarding, RPC nova, backfill) optaria a régua por FECHAR atendimento.
alter table public.followup_rulesets alter column close_ticket_on_exhaust set default false;

comment on column public.followup_rulesets.close_ticket_on_exhaust is
  'Ao terminar ESTA régua, encerrar o atendimento como Perdido (o último passo ativo é a despedida). Default FALSE e ausência de linha também valem como não encerrar: fechar atendimento é destrutivo e precisa de opt-in explícito. As réguas anteriores a 18/08/2026 receberam linha explícita com o comportamento que já tinham.';

-- (3) O CLAIM re-checa "contato fora do WhatsApp".
--
-- O selector passou a excluir whatsapp_invalid, mas o claim (que existe justamente para re-checar
-- as exclusões duráveis na janela entre listar e enviar) não recebeu a mesma cláusula. Se o
-- Emissor marcar o contato nesse intervalo, o claim consumia o passo, o envio era recusado e o
-- passo NÃO era devolvido: como o selector agora exclui esse contato para sempre, a cadência
-- ficava parada no meio, sem despedida e sem encerramento, para sempre.
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
  v_prev_cycle int;
  v_new_sent timestamp;
  v_cycle int;
  v_ok int;
begin
  select followup_count, followup_ruleset_stage_id, followup_sent_at, coalesce(followup_cycle, 0)
    into v_prev_count, v_prev_stage, v_prev_sent, v_prev_cycle
    from public.leads where id = p_lead_id for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'lead_nao_encontrado');
  end if;

  update public.leads l
     set followup_count            = p_expected + 1,
         followup_sent_at          = (now() at time zone 'America/Sao_Paulo'),
         followup_ruleset_stage_id = p_stage_id,
         followup_cycle            = case when p_expected = 0 then coalesce(l.followup_cycle, 0) + 1
                                          else coalesce(l.followup_cycle, 0) end
   where l.id = p_lead_id
     and l.followup_enabled = true
     and l.ai_enabled = true
     and l.handoff_triggered_at is null
     and l.converted_patient_id is null
     -- mesma exclusão durável do selector: sem isto o passo é queimado num contato que o Emissor
     -- acabou de marcar como fora do WhatsApp, e ele nunca mais é selecionado para recuperar
     and coalesce(l.whatsapp_invalid, false) = false
     and not exists (select 1 from public.lead_followup_optout o
                      where o.lead_id = l.id and o.kind = 'reengagement')
     and (
          (l.followup_ruleset_stage_id is not distinct from p_stage_id and l.followup_count = p_expected)
       or (l.followup_ruleset_stage_id is distinct from p_stage_id     and p_expected = 0)
       -- rollback do gate: com a régua por etapa desligada só o contador manda, e o próprio claim
       -- limpa a marca (p_stage_id chega null), devolvendo o contato ao estado antigo.
       or (not public.fn_reengajamento_por_etapa_ativo() and l.followup_count = p_expected)
     )
  returning l.followup_sent_at, l.followup_cycle into v_new_sent, v_cycle;

  get diagnostics v_ok = row_count;

  return jsonb_build_object(
    'claimed', v_ok = 1,
    'reason', case when v_ok = 1 then null else 'not_claimed' end,
    'prev_count', v_prev_count,
    'prev_stage_id', v_prev_stage,
    'prev_sent_at', v_prev_sent,
    'prev_cycle', v_prev_cycle,
    'sent_at', v_new_sent,
    'cycle', v_cycle);
end;
$function$;

revoke all on function public.fn_claim_reengagement_step(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.fn_claim_reengagement_step(uuid, uuid, int) to service_role;
