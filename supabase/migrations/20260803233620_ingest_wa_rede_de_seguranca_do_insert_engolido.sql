-- PERDA SILENCIOSA: mensagem recebida que NUNCA chega ao agente, sem erro em lugar nenhum.
--
-- Mecanica (confirmada no banco vivo):
--   `ingest_wa_message` busca o lead por telefone normalizado. Nao achou e e inbound, tenta INSERT.
--   Mas a trigger BEFORE INSERT `fn_handle_lead_uniqueness` faz `RETURN NULL` quando ELA encontra o
--   lead (funde a duplicata). Nesse caso o INSERT e ENGOLIDO: nao existe `unique_violation`, o
--   `exception when unique_violation` logo acima NAO dispara, e o `returning ... into v_lead` nao
--   atribui nada. `v_lead.id` fica NULO.
--   Como `v_forward` (linha ~97) exige `v_lead.id is not null`, o resultado e: a mensagem entra na
--   conversa normalmente (o trigger de chat_messages resolve o lead pelo telefone e preenche), mas
--   O AGENTE NUNCA E ACIONADO. Nada na Central. O paciente escreve e ninguem responde.
--
-- Quando isso acontece: `normalize_br_phone` e IDEMPOTENTE (medido: 0 divergencias em 5.000
-- telefones), entao a trigger so acha o que a busca inicial nao achou se o lead NASCEU ENTRE as
-- duas, ou seja em RAJADA de contato novo (duas mensagens processadas em paralelo). O padrao e
-- comum: 1.095 leads em 60 dias receberam a 2a mensagem em menos de 2 segundos da primeira.
--
-- ⚠️ E o monitor `turno_sem_resposta` e CEGO para este caso: ele exige `exists (sender='ai')`, e
-- aqui o agente nunca falou com essa pessoa antes. Por isso a rede de seguranca acende sozinha.
--
-- PROVADO em transacao revertida, simulando a corrida (busca inicial desativada de proposito):
--   sem a rede -> lead_id nulo e forward_ai = FALSE (o turno se perdia)
--   com a rede -> lead resolvido e forward_ai = TRUE
--
-- Correcao aplicada por CIRURGIA no texto da funcao (nao reescrita a mao): o resto do corpo fica
-- byte a byte identico, o que importa numa funcao por onde passa TODA mensagem recebida.
do $mig$
declare
  v_def text;
  v_ancora text := E'    exception when unique_violation then';
  v_fim    text := E'\n  end if;\n';
  v_bloco  text;
  p1 int; p2 int; corte int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ingest_wa_message'
    and pg_get_function_identity_arguments(p.oid) like 'p_instance_token text, p_direction text%';

  if v_def is null then raise exception 'ingest_wa_message nao encontrada'; end if;
  if position('lead_nao_resolvido' in v_def) > 0 then
    raise notice 'rede de seguranca ja aplicada; nada a fazer'; return;
  end if;

  p1 := position(v_ancora in v_def);
  if p1 = 0 then raise exception 'ancora do exception nao encontrada'; end if;
  p2 := position(v_fim in substr(v_def, p1));
  if p2 = 0 then raise exception 'fim do bloco de insert nao encontrado'; end if;
  corte := p1 + p2 - 1 + length(v_fim);   -- logo depois do `end if;` do bloco de insert

  v_bloco :=
E'
  -- ⚠️ REDE DE SEGURANCA: o INSERT acima pode ter sido ENGOLIDO pela trigger
  -- `fn_handle_lead_uniqueness`, que faz RETURN NULL quando ela mesma encontra o lead. Nesse caso
  -- nao ha `unique_violation`, o handler acima nao roda, o `returning` nao atribui e `v_lead.id`
  -- fica nulo -- e com ele nulo o `v_forward` la embaixo vira false e O AGENTE NAO E ACIONADO,
  -- em silencio. So acontece em rajada de contato novo (o lead nasce entre a busca e o insert).
  -- Aqui a gente re-busca; se ainda assim nao achar, acende na Central em vez de calar.
  if v_lead.id is null and p_direction = ''inbound'' then
    select id, ai_enabled, is_not_lead, name into v_lead
    from leads where clinic_id = v_clinic and normalize_br_phone(phone) = v_norm
    order by last_activity_at desc nulls last limit 1;
    -- Nada foi criado por nos: o insert foi engolido. (A linha `v_lead_created := true` acima roda
    -- mesmo quando o insert afeta 0 linhas, entao ela precisa ser desfeita aqui.)
    v_lead_created := false;
    if v_lead.id is null then
      begin
        perform log_system_error(
          ''wa-inbound'', ''lead_nao_resolvido'',
          ''Mensagem recebida sem conseguir resolver o lead: o agente NAO foi acionado'',
          ''critical'', v_clinic,
          jsonb_build_object(''telefone'', v_norm, ''wa_message_id'', p_wa_message_id), false);
      exception when others then null;  -- Central fora do ar nao pode derrubar a ingestao
      end;
    end if;
  end if;
';

  v_def := substr(v_def, 1, corte - 1) || v_bloco || substr(v_def, corte);
  execute v_def;
end $mig$;

-- CLAUDE.md §1: reafirma o fechamento (o ACL de origem era postgres + service_role).
revoke all on function public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric,text)
  from public, anon, authenticated;
grant execute on function public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric,text)
  to service_role;
