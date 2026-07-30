-- "Numero nao esta no WhatsApp" so marcava o contato quando a mensagem era o welcome de
-- formulario (o `if r.producer = 'forms_welcome'` de 28/07). Para qualquer outro envio, o
-- desfecho se perdia: o card do Kanban continuava com cara de contato normal, a atendente
-- seguia com o botao de enviar habilitado, e a proxima automacao tentava de novo, gastava as 3
-- tentativas e acendia mais um alerta CRITICO na Central. Medido em 29 e 30/07: dois numeros
-- FIXOS (21 2022-8426 pelo reengajamento e 11 3321-6836 pelo encerramento de atendimento).
--
-- Aqui a marca sai do ramo do welcome e passa a valer para todo produtor. O que MUDA por tenant:
-- o cartao passa a mostrar "numero nao esta no WhatsApp" e o envio manual daquele lead fica
-- bloqueado com esse motivo na tela, que e a informacao que faltava para a equipe.
--
-- ⚠️ De proposito, isto NAO barra o proximo envio automatico. A marca so aparece depois de 3
-- tentativas com o provedor dizendo explicitamente que o numero nao existe, mas ela tambem e
-- escrita pelo /chat/check da forms-welcome-followup, que ja errou com numero valido. Transformar
-- a marca em bloqueio de fila e decisao de produto: se errar, silencia o paciente inteiro sem
-- erro nenhum, que e a familia de defeito mais cara deste sistema.
--
-- ⚠️ A retomada tambem continua existindo: a forms-welcome-followup zera whatsapp_invalid quando
-- o check confirma o numero (linhas 335 e 360 da edge). Nao transformar isso em estado terminal.
--
-- ⚠️ COMPLEMENTADA na hora seguinte por 20260730141737: faltava a trava de endereco confiavel.
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

    v_sem_whatsapp := coalesce(p_error, '') ilike '%not on whatsapp%'
                   or coalesce(p_error, '') ilike '%not_on_whatsapp%'
                   or coalesce(p_provider_response::text, '') ilike '%not on whatsapp%';

    -- Vale para QUALQUER produtor: quem descobriu que o numero nao existe foi o provedor, e o
    -- fato nao muda conforme quem mandou a mensagem.
    if v_sem_whatsapp and r.lead_id is not null then
      update public.leads set whatsapp_invalid = true
       where id = r.lead_id and coalesce(whatsapp_invalid, false) is distinct from true;
    end if;

    -- A escada de retentativa do welcome continua exclusiva dele: welcome_attempts e welcome_sent
    -- so existem nesse fluxo, e devolver a linha para a fila depende do dedup_key 'welcome:...'.
    if r.producer = 'forms_welcome' and r.lead_id is not null and not v_sem_whatsapp then
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
