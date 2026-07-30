-- Complemento imediato da migration anterior. Ao aplicar a marca no historico eu mesmo cai na
-- armadilha: entre 24 e 27/07 o emit_message mandava o welcome para o telefone SEM o 9o digito, e
-- a uazapi respondia "the number ... is not on WhatsApp". Aquele "nao existe" e sobre o ENDERECO
-- que nos montamos errado, nao sobre a pessoa: seis celulares validos do Rio seriam marcados como
-- invalidos e sumiriam do monitor de welcome, que ignora quem esta marcado.
--
-- Regra: so confia no veredito do provedor quando o endereco usado NAO tem cara de celular
-- mutilado. Numero de 12 digitos (55 + DDD + 8) cuja parte local comeca em 6-9 e celular sem o 9;
-- comecando em 2-5 e fixo de verdade, e ai a marca vale. Essa leitura por faixa e a mesma do
-- CLAUDE.md, e a unica coisa que separa fixo de celular mutilado sem consultar a operadora.
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
  v_endereco_confiavel boolean;
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

    -- Endereco suspeito de ser celular sem o 9o digito: nao serve de prova contra a pessoa.
    v_endereco_confiavel := not (
      coalesce(length(r.to_addr), 0) = 12 and substr(r.to_addr, 5, 1) in ('6','7','8','9')
    );

    -- Vale para QUALQUER produtor: quem descobriu que o numero nao existe foi o provedor, e o
    -- fato nao muda conforme quem mandou a mensagem.
    if v_sem_whatsapp and v_endereco_confiavel and r.lead_id is not null then
      update public.leads set whatsapp_invalid = true
       where id = r.lead_id and coalesce(whatsapp_invalid, false) is distinct from true;
    end if;

    -- A escada de retentativa do welcome continua exclusiva dele: welcome_attempts e welcome_sent
    -- so existem nesse fluxo, e devolver a linha para a fila depende do dedup_key 'welcome:...'.
    -- Endereco suspeito cai AQUI de proposito: em vez de marcar o contato, tenta de novo.
    if r.producer = 'forms_welcome' and r.lead_id is not null
       and not (v_sem_whatsapp and v_endereco_confiavel) then
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

-- Backfill aplicado junto (dados, nao schema), registrado aqui para historia:
--   1) marcou whatsapp_invalid nos leads com falha terminal "not on whatsapp"  -> 10 leads;
--   2) desmarcou os 6 cujo endereco era celular sem o 9 (24 a 27/07)          -> sobraram 4 fixos.
-- Os 6 desmarcados foram conferidos um a um: todos tem conversa (2 a 24 mensagens), ou seja,
-- estao no WhatsApp e a marca teria sido um falso positivo meu.
