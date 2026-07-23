-- Detecção de FALHA DE INFRA no Emissor (conta do WhatsApp fora do ar ou restrita).
--
-- Hoje SÓ a forms-welcome faz isso: quando a uazapi devolve 503 (desconectado) ou 463/
-- reachout_timelock (conta restringida pelo WhatsApp), ela seta whatsapp_instances.send_blocked_until
-- e devolve o lead à fila SEM consumir tentativa — "a culpa da infra não cai no lead". Sem isto no
-- worker, ao migrar a forms-welcome perderíamos essa proteção: a mensagem gastaria as 3 tentativas
-- contra uma parede em ~7 min e cairia na DLQ antes de a conta voltar.
--
-- Esta função: (1) bloqueia a INSTÂNCIA (o gate fn_clinic_send_token já respeita send_blocked_until,
-- então TODOS os produtores param de martelar a conta), (2) devolve a mensagem à fila para depois
-- do bloqueio, DEVOLVENDO a tentativa consumida no claim (não penaliza), (3) tem um teto: mensagem
-- com mais de 24h vira 'dropped' com alerta, para a fila não crescer sem fim se a conta nunca voltar.

create or replace function public.mark_outbound_infra_blocked(
  p_id uuid,
  p_clinic_id uuid,
  p_until timestamptz,
  p_error text
) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  r public.outbound_messages;
  v_until timestamptz := coalesce(p_until, now() + interval '15 minutes');
begin
  select * into r from public.outbound_messages where id = p_id;
  if not found then return; end if;

  -- Bloqueia a instância da clínica: nenhum produtor tenta enviar até o WhatsApp voltar.
  update public.whatsapp_instances
     set send_blocked_until = greatest(coalesce(send_blocked_until, v_until), v_until)
   where clinic_id = p_clinic_id;

  -- Teto: mensagem velha demais (conta não voltou em 24h) vira dropped, com alerta.
  if r.created_at < now() - interval '24 hours' then
    update public.outbound_messages
       set status = 'dropped', last_error = 'WhatsApp indisponível por mais de 24h: ' || coalesce(p_error,'')
     where id = p_id;
    perform public.log_system_error('emissor','infra_descartada',
      'Mensagem descartada: WhatsApp da clínica indisponível por mais de 24h', 'critical', p_clinic_id,
      jsonb_build_object('outbound_id', p_id, 'lead_id', r.lead_id, 'producer', r.producer), false);
    return;
  end if;

  -- Devolve à fila para depois do bloqueio, SEM contar a tentativa (undo do claim).
  update public.outbound_messages
     set status = 'pending',
         not_before = v_until,
         attempts = greatest(r.attempts - 1, 0),
         claimed_at = null, claimed_by = null,
         last_error = coalesce(p_error, 'WhatsApp indisponível (infra)')
   where id = p_id;
end $$;

revoke all on function public.mark_outbound_infra_blocked(uuid,uuid,timestamptz,text) from anon, authenticated;