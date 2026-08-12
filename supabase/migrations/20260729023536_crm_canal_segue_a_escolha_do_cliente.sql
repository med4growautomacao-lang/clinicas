-- 20260729023536_crm_canal_segue_a_escolha_do_cliente
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- CRM externo: o canal do lead novo passa a seguir a ESCOLHA DO CLIENTE, em vez de ser fixo.
--
-- DECISAO DO DONO (28/07/2026): quem responde "de onde esse contato veio" nao somos nos, e o
-- cliente, e ele ja respondeu em "Onde o card comeca" (clinic_external_integrations.entry_stage_slug).
-- A escolha da etapa declara o fluxo dele, e o fluxo determina o canal. Medido em producao:
--   . Intubação: lead_enabled=false. O webhook do site manda para nos E para o Clint em paralelo;
--     o Clint so devolve ganho/perdido. Escolha = 'forms', e e formulario mesmo. NADA MUDA.
--   . GG Imports: lead_enabled=TRUE. O lead novo chega PELO Clint. Escolha = 'whatsapp' (e loja,
--     atende por WhatsApp). Hoje nasceria 'forms', que seria mentira. PASSA A NASCER 'whatsapp'.
-- Nenhum registro existente muda: nao ha nenhum lead criado por este caminho ate agora.
--
-- A regra vale SO onde nao sabemos o canal (contato que o CRM cria do zero). Ela nunca sobrepoe
-- canal conhecido: formulario nativo continua 'forms' e quem manda mensagem continua 'whatsapp'.
--
-- AS DUAS MUDANCAS SAO INSEPARAVEIS (verificado no banco vivo):
--   (a) o canal deixa de ser fixo
--   (b) a RPC passa a abrir o card que o trg_auto_open_ticket_forms abria
-- Aplicar so (a) faz todo 'ganho' de contato novo cair em 'sem_ticket' e a VENDA sumir de todos
-- os paineis, sem erro nenhum. O trg_auto_open_ticket_forms so dispara com canal 'forms'.

create or replace function public.apply_external_crm_outcome(
  p_clinic_id uuid, p_outcome text, p_phone text, p_email text default null,
  p_name text default null, p_loss_reason text default null, p_source text default null,
  p_campaign text default null, p_adset text default null, p_ad text default null,
  p_ad_platform text default null, p_raw jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
DECLARE
  v_event_id uuid; v_lead_id uuid; v_ticket_id uuid; v_prev_ticket uuid; v_stage_id uuid;
  v_nphone text; v_deal_key text; v_created boolean := false; v_new_tkt boolean := false;
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta boolean := (p_source IN ('meta_ads','instagram'));
  v_cur_out text; v_fin jsonb;
  v_canal text;
BEGIN
  IF p_outcome NOT IN ('ganho','perdido','lead') THEN
    RETURN jsonb_build_object('error','invalid_outcome');
  END IF;

  -- Antes alternava '1'/'0' porque a marca decidia se a trigger de forms abria o card.
  -- Agora quem abre o card e esta RPC em TODOS os ramos, entao a marca e uniforme e o
  -- risco de heranca dentro de um lote deixa de existir (ha lotes REAIS de ate 1.225
  -- chamadas na mesma transacao, conferido em external_crm_events).
  PERFORM set_config('app.crm_intake', '1', true);

  -- O canal segue a escolha do cliente. fn_clinic_entry_stage_slug devolve 'forms' ou 'whatsapp'
  -- (CHECK na coluna), os dois dentro do vocabulario fechado de capture_channel.
  v_canal := public.fn_clinic_entry_stage_slug(p_clinic_id);

  INSERT INTO public.external_crm_events (clinic_id, outcome, name, phone, email, loss_reason, raw)
  VALUES (p_clinic_id, p_outcome, p_name, p_phone, p_email, p_loss_reason, p_raw)
  RETURNING id INTO v_event_id;

  v_nphone  := normalize_br_phone(p_phone);
  v_lead_id := public.fn_find_lead_by_identity(p_clinic_id, v_nphone, p_email);

  IF v_lead_id IS NULL THEN
    IF COALESCE(NULLIF(trim(p_phone),''), NULLIF(trim(p_email),'')) IS NULL THEN
      RETURN jsonb_build_object('error','sem_identidade','event_id',v_event_id);
    END IF;

    BEGIN
      INSERT INTO public.leads (
        clinic_id, name, phone, email, source, capture_channel, ad_platform,
        g_campaign_name, g_adset_name, g_ad_name, fb_campaign_name, fb_adset_name, fb_ad_name
      ) VALUES (
        p_clinic_id, COALESCE(NULLIF(trim(p_name),''),'Lead'),
        COALESCE(v_nphone, NULLIF(trim(p_phone),'')), NULLIF(trim(p_email),''),
        p_source, v_canal, NULLIF(trim(p_ad_platform),''),
        CASE WHEN v_is_google THEN p_campaign END, CASE WHEN v_is_google THEN p_adset END, CASE WHEN v_is_google THEN p_ad END,
        CASE WHEN v_is_meta   THEN p_campaign END, CASE WHEN v_is_meta   THEN p_adset END, CASE WHEN v_is_meta   THEN p_ad END
      )
      RETURNING id INTO v_lead_id;

      IF v_lead_id IS NOT NULL THEN
        v_created := true;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Corrida: outro webhook criou o MESMO lead entre o lookup e o insert. Sem este bloco a
      -- excecao subia e o rollback levava junto a linha de external_crm_events (o evento sumia
      -- da tabela que o monitor de silencio le).
      PERFORM public.log_system_error(
        'apply_external_crm_outcome', 'lead_corrida_unique',
        'Corrida ao criar lead do CRM externo (recuperada, sem perda)', 'warn', p_clinic_id,
        jsonb_build_object('outcome', p_outcome, 'event_id', v_event_id,
                           'tem_telefone', NULLIF(trim(p_phone),'') IS NOT NULL,
                           'tem_email', NULLIF(trim(p_email),'') IS NOT NULL),
        false);
    END;

    -- Reencontra em dois casos: a corrida acima, e a mesclagem silenciosa do
    -- fn_handle_lead_uniqueness (BEFORE INSERT que devolve NULL quando o contato ja existe).
    IF v_lead_id IS NULL THEN
      v_lead_id := public.fn_find_lead_by_identity(p_clinic_id, v_nphone, p_email);
    END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('error','lead_indisponivel','event_id',v_event_id);
  END IF;

  -- LEAD NOVO: garante card ABERTO e para. Sem desfecho, sem finalize_ticket.
  IF p_outcome = 'lead' THEN
    SELECT id INTO v_ticket_id FROM public.tickets
     WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;

    IF v_ticket_id IS NULL THEN
      -- Dedup de REPLAY. Sem isto, a sequencia lead -> ganho -> reentrega do lead original abria
      -- um card novo num lead ja ganho: o card ressuscitava e o funil contava a pessoa duas vezes.
      v_deal_key := NULLIF(trim(COALESCE(p_raw->>'deal_created_at', p_raw->>'deal_id', p_raw->>'id')), '');

      IF v_deal_key IS NOT NULL THEN
        SELECT e.ticket_id INTO v_prev_ticket FROM public.external_crm_events e
         WHERE e.clinic_id = p_clinic_id AND e.lead_id = v_lead_id
           AND e.outcome = 'lead' AND e.id <> v_event_id AND e.ticket_id IS NOT NULL
           AND NULLIF(trim(COALESCE(e.raw->>'deal_created_at', e.raw->>'deal_id', e.raw->>'id')), '') = v_deal_key
         ORDER BY e.received_at DESC LIMIT 1;
      ELSE
        -- Sem chave de negocio no payload, so da para barrar o retry imediato.
        SELECT e.ticket_id INTO v_prev_ticket FROM public.external_crm_events e
         WHERE e.clinic_id = p_clinic_id AND e.lead_id = v_lead_id
           AND e.outcome = 'lead' AND e.id <> v_event_id AND e.ticket_id IS NOT NULL
           AND e.received_at > now() - interval '10 minutes'
         ORDER BY e.received_at DESC LIMIT 1;
      END IF;

      IF v_prev_ticket IS NOT NULL THEN
        UPDATE public.external_crm_events
           SET lead_id = v_lead_id, ticket_id = v_prev_ticket WHERE id = v_event_id;
        RETURN jsonb_build_object('ok',true,'skipped',true,'motivo','replay',
                                  'lead_id',v_lead_id,'ticket_id',v_prev_ticket,'outcome','lead',
                                  'created_lead',v_created,'created_ticket',false);
      END IF;

      v_stage_id := public.fn_default_entry_stage(p_clinic_id, v_canal);

      IF v_stage_id IS NULL THEN
        UPDATE public.external_crm_events SET lead_id = v_lead_id WHERE id = v_event_id;
        PERFORM public.log_system_error(
          'apply_external_crm_outcome', 'sem_etapa_no_funil',
          'Lead do CRM chegou mas a clinica nao tem etapa de funil para receber', 'error', p_clinic_id,
          jsonb_build_object('lead_id', v_lead_id, 'event_id', v_event_id), false);
        RETURN jsonb_build_object('error','sem_etapa_no_funil','lead_id',v_lead_id,'event_id',v_event_id);
      END IF;

      BEGIN
        PERFORM set_config('app.stage_source', 'crm_lead', true);
        INSERT INTO public.tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, v_lead_id, v_stage_id, 'open', now())
        RETURNING id INTO v_ticket_id;
        v_new_tkt := true;
        PERFORM set_config('app.stage_source', '', true);
      EXCEPTION WHEN unique_violation THEN
        -- uq_tickets_one_open_per_lead: outra rota abriu o card no meio do caminho. Usa o dela.
        PERFORM set_config('app.stage_source', '', true);
        SELECT id INTO v_ticket_id FROM public.tickets
         WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
      END;
    END IF;

    UPDATE public.external_crm_events
       SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;

    IF v_ticket_id IS NULL THEN
      PERFORM public.log_system_error(
        'apply_external_crm_outcome', 'ticket_nao_aberto',
        'Lead do CRM entrou mas o card nao foi aberto (corrida nao resolvida)', 'error', p_clinic_id,
        jsonb_build_object('lead_id', v_lead_id, 'event_id', v_event_id), false);
      RETURN jsonb_build_object('error','ticket_nao_aberto','lead_id',v_lead_id,'event_id',v_event_id);
    END IF;

    RETURN jsonb_build_object('ok',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome','lead',
                              'created_lead',v_created,'created_ticket',v_new_tkt);
  END IF;

  -- Card alvo: aberto primeiro; senao o mais recente (finalize_ticket sobrescreve fechado)
  SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
   WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
     WHERE lead_id = v_lead_id ORDER BY opened_at DESC LIMIT 1;
  END IF;

  -- NOVO E OBRIGATORIO. Quem abria este card era o trg_auto_open_ticket_forms, que so dispara
  -- com capture_channel='forms'. Com o canal em 'whatsapp' ele nao dispara mais. Sem este bloco,
  -- um 'ganho' de contato novo retornaria 'sem_ticket' e a VENDA sumiria de todos os paineis.
  -- Gate em v_created para NAO mudar o comportamento de lead preexistente sem card (esse continua
  -- caindo em 'sem_ticket', como hoje; medido: hoje nao existe nenhum lead assim nas 2 clinicas).
  IF v_ticket_id IS NULL AND v_created THEN
    v_stage_id := public.fn_default_entry_stage(p_clinic_id, v_canal);
    IF v_stage_id IS NOT NULL THEN
      BEGIN
        PERFORM set_config('app.stage_source', 'crm_lead', true);
        INSERT INTO public.tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, v_lead_id, v_stage_id, 'open', now())
        RETURNING id INTO v_ticket_id;
        v_new_tkt := true;
        PERFORM set_config('app.stage_source', '', true);
      EXCEPTION WHEN unique_violation THEN
        PERFORM set_config('app.stage_source', '', true);
        SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
         WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
      END;
    END IF;
  END IF;

  IF v_ticket_id IS NULL THEN
    UPDATE public.external_crm_events SET lead_id = v_lead_id WHERE id = v_event_id;
    -- Antes este caminho era MUDO. Se falha em silencio, nao existe (Central de Erros).
    PERFORM public.log_system_error(
      'apply_external_crm_outcome', 'sem_ticket',
      'Desfecho do CRM chegou mas o lead nao tem card para receber', 'warn', p_clinic_id,
      jsonb_build_object('lead_id', v_lead_id, 'event_id', v_event_id, 'outcome', p_outcome), false);
    RETURN jsonb_build_object('error','sem_ticket','lead_id',v_lead_id,'event_id',v_event_id);
  END IF;

  -- Idempotencia: card ja esta nesse desfecho -> nao re-finaliza
  IF v_cur_out IS NOT NULL AND v_cur_out = p_outcome THEN
    UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;
    RETURN jsonb_build_object('ok',true,'skipped',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome',p_outcome,'created_lead',v_created);
  END IF;

  v_fin := public.finalize_ticket(v_ticket_id, p_outcome, p_loss_reason, NULL, true);

  UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;

  RETURN jsonb_build_object('ok',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome',p_outcome,
                            'created_lead',v_created,'created_ticket',v_new_tkt,'finalize',v_fin);
END;
$function$;

-- CREATE OR REPLACE preserva a ACL, mas repetimos para a migration nao mentir.
revoke all on function public.apply_external_crm_outcome(uuid,text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_external_crm_outcome(uuid,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

-- Onde o canal for 'whatsapp', quem passa a criar o toque da jornada e o
-- fn_touchpoint_from_direct_contact, que escreveria 'Mandou mensagem no WhatsApp'.
-- Seria mentira: o contato do CRM nunca mandou mensagem nenhuma.
-- A alteracao e ADITIVA (um ramo novo) e so liga sob app.crm_intake='1', marca que SOMENTE a
-- RPC acima seta. Todo o resto do corpo e identico ao que esta em producao.
create or replace function public.fn_touchpoint_from_direct_contact()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_channel text;
  v_detail  text;
begin
  v_channel := coalesce(new.capture_channel, 'whatsapp');

  if v_channel = 'forms' then
    return null;
  end if;

  if nullif(new.ctwa_clid,'') is not null
     or nullif(new.fb_clid,'') is not null
     or nullif(new.g_clid,'') is not null then
    return null;
  end if;

  v_detail := case
                when coalesce(current_setting('app.crm_intake', true), '') = '1'
                  then 'Negócio criado no CRM externo'
                when v_channel = 'balcao' then 'Atendimento no balcão'
                when v_channel = 'manual' then 'Cadastro manual'
                else 'Mandou mensagem no WhatsApp'
              end;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     v_channel, new.source,
     coalesce(new.fb_campaign_name, new.g_campaign_name),
     coalesce(new.fb_adset_name,    new.g_adset_name),
     coalesce(new.fb_ad_name,       new.g_ad_name),
     v_detail, new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$function$;
