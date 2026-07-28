-- Buraco irmao do bug do 9o digito: quando o welcome de forms morre DENTRO do Emissor, ninguem
-- avisava o lead. O claim (welcome_sent=true) e feito antes do envio, e o retry inline da edge
-- (passo 6b) so existe no caminho antigo, sem Emissor. Resultado: welcome_sent=true,
-- whatsapp_invalid=false, zero chat_messages, e o lead tambem sai do reengajamento (que so olha
-- quem tem conversa). Foi assim que 6 leads da Clinica Vaz ficaram mudos entre 24 e 27/07.
--
-- Agora a falha terminal tem desfecho explicito:
--   • numero confirmado sem WhatsApp  -> whatsapp_invalid=true (mesmo desfecho do /chat/check da
--     edge: sinaliza no card do Kanban e NAO reenvia);
--   • qualquer outra falha            -> devolve o lead para a fila do cron ate o teto de 3
--     tentativas (MAX_ATTEMPTS da forms-welcome-followup).
--
-- Liberar o dedup_key ao devolver e LOAD-BEARING: a edge monta a chave como
-- 'welcome:<lead_id>:<balao>', fixa por lead. Com a linha morta segurando essa chave, o
-- on conflict do nothing do emit_message devolveria o id antigo e o "retry" reenviaria NADA,
-- em silencio, para sempre.
create or replace function public.mark_outbound_failed(
  p_id uuid,
  p_error text,
  p_provider_status integer default null::integer,
  p_provider_response jsonb default null::jsonb,
  p_permanente boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.outbound_messages;
  v_sem_whatsapp boolean;
  v_tentativas int;
begin
  select * into r from public.outbound_messages where id = p_id;
  if not found then return; end if;

  if p_permanente or r.attempts >= r.max_attempts then
    update public.outbound_messages
       set status = case when p_permanente then 'dropped' else 'failed' end,
           last_error = p_error, provider_status = p_provider_status,
           provider_response = p_provider_response
     where id = p_id;

    perform public.log_system_error(
      'emissor',
      case when p_permanente then 'envio_descartado' else 'envio_esgotou_tentativas' end,
      case when p_permanente
           then 'Mensagem descartada sem envio: ' || coalesce(p_error, 'sem detalhe')
           else 'Mensagem NAO entregue apos ' || r.attempts || ' tentativas: ' || coalesce(p_error, 'sem detalhe') end,
      'critical', r.clinic_id,
      jsonb_build_object('outbound_id', r.id, 'lead_id', r.lead_id, 'producer', r.producer,
                         'destino', r.to_addr, 'status_http', p_provider_status,
                         'tentativas', r.attempts),
      false
    );

    if r.producer = 'forms_welcome' and r.lead_id is not null then
      v_sem_whatsapp := coalesce(p_error, '') ilike '%not on whatsapp%'
                     or coalesce(p_error, '') ilike '%not_on_whatsapp%'
                     or coalesce(p_provider_response::text, '') ilike '%not on whatsapp%';

      if v_sem_whatsapp then
        update public.leads set whatsapp_invalid = true where id = r.lead_id;
      else
        select coalesce(welcome_attempts, 0) + 1 into v_tentativas
          from public.leads where id = r.lead_id;

        update public.leads
           set welcome_attempts = v_tentativas,
               -- abaixo do teto: volta para a fila (welcome_sent=false). No teto: desiste.
               welcome_sent = (v_tentativas >= 3)
         where id = r.lead_id;

        if v_tentativas < 3 and r.dedup_key is not null then
          update public.outbound_messages
             set dedup_key = r.dedup_key || ':t' || r.attempts
           where id = p_id;
        end if;
      end if;
    end if;
  else
    -- 30s, 90s, 270s...
    update public.outbound_messages
       set status = 'pending',
           not_before = now() + (interval '30 seconds' * power(3, greatest(r.attempts - 1, 0))),
           last_error = p_error, provider_status = p_provider_status,
           provider_response = p_provider_response
     where id = p_id;
  end if;
end $function$;

revoke all on function public.mark_outbound_failed(uuid, text, integer, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.mark_outbound_failed(uuid, text, integer, jsonb, boolean) to service_role;
