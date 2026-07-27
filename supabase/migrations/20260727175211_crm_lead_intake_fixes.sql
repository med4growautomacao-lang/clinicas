-- Correções do review do tipo=lead do CRM (27/07). Decisão do dono: o lead do CRM entra na
-- etapa WHATSAPP (não em forms).
--
-- ⚠️ O ACHADO QUE MUDA TUDO: trocar o slug dentro da RPC NÃO cumpre a decisão.
-- Quando a RPC cria o lead com capture_channel='forms', quem abre o ticket é o trigger
-- trg_auto_open_ticket_forms (AFTER INSERT em leads), que roda ANTES de a RPC chegar na própria
-- busca de etapa e já grava stage='forms'. O SELECT de ticket aberto da RPC encontra esse ticket
-- e o bloco de escolha de etapa vira código morto. Quem manda na etapa do lead novo é a TRIGGER.
--
-- Solução: uma marca de transação, `app.crm_intake`, no mesmo idioma que o fn_log_ticket_stage_change
-- já usa (`app.stage_source`/`app.stage_actor`). Ela diz "este lead está sendo criado pelo webhook
-- do CRM, não por atividade real do paciente", e TRÊS triggers passam a respeitá-la:
--   1. fn_auto_open_ticket_forms   -> não abre o ticket (quem abre é a RPC, na etapa whatsapp)
--   2. fn_touchpoint_from_site_form -> grava o toque com texto honesto (não "Preencheu formulário")
--   3. fn_reset_followup_on_new_ticket -> não limpa handoff nem re-arma follow-up
-- Quando a marca não está setada, `current_setting(..., true)` devolve NULL, a condição é falsa e
-- o comportamento é IDÊNTICO ao de hoje para todos os outros chamadores. É no-op provável.
--
-- ⚠️ A marca só vale para p_outcome='lead'. Ganho/perdido seguem EXATAMENTE como estão hoje
-- (5.5k eventos em produção dependem disso): o trigger de forms abre o ticket e o finalize fecha.
--
-- Também corrige, do mesmo review:
--  • monitor crm_desfecho_silencioso ficava cego (lead mascarava desfecho morto)
--  • INSERT de lead sem guarda de unique_violation (a exceção levava junto o evento, por rollback)
--  • replay do CRM abria ciclo novo (dedup por chave de negócio, com janela como plano B)
--  • cascata de etapa copiada 3x e lookup de lead copiado 2x (viraram helper)
--  • created_ticket mentia (dizia false quando o ticket tinha acabado de nascer)
--  • ramo de corrida podia devolver ok:true com ticket_id NULL, sem nada na Central

-- ── 1. Helpers: fim das cópias ───────────────────────────────────────────────────────────────

-- Etapa de entrada do funil. Ordem: a preferida, depois whatsapp, depois a primeira que existir.
-- Os 34 tenants com funil têm 'forms' E 'whatsapp', então o 3º nível é rede de segurança para
-- clínica nova ou funil editado à mão.
create or replace function public.fn_default_entry_stage(p_clinic_id uuid, p_prefer_slug text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select id from public.funnel_stages
      where clinic_id = p_clinic_id and slug = p_prefer_slug order by position limit 1),
    (select id from public.funnel_stages
      where clinic_id = p_clinic_id and slug = 'whatsapp'   order by position limit 1),
    (select id from public.funnel_stages
      where clinic_id = p_clinic_id                          order by position limit 1)
  );
$$;

comment on function public.fn_default_entry_stage(uuid, text) is
  'Etapa de entrada do funil: slug preferido -> whatsapp -> primeira por position. Fonte unica das 3 copias que existiam (fn_auto_open_ticket, fn_auto_open_ticket_forms, apply_external_crm_outcome).';

-- Identidade do lead: telefone normalizado (>=12 digitos) e depois e-mail. O guard de 12 digitos
-- existe porque numero sem DDD nao entra no indice de unicidade e casaria com quem nao devia.
create or replace function public.fn_find_lead_by_identity(p_clinic_id uuid, p_nphone text, p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select id from public.leads
      where clinic_id = p_clinic_id
        and p_nphone is not null and length(p_nphone) >= 12
        and normalize_br_phone(phone) = p_nphone
      limit 1),
    (select id from public.leads
      where clinic_id = p_clinic_id
        and nullif(trim(p_email), '') is not null
        and lower(email) = lower(trim(p_email))
      limit 1)
  );
$$;

comment on function public.fn_find_lead_by_identity(uuid, text, text) is
  'Casa lead por telefone normalizado (>=12 digitos) e depois por e-mail. Usada pelo pipeline do CRM externo.';

-- ── 2. Os tres triggers passam a respeitar a marca de intake do CRM ──────────────────────────

create or replace function public.fn_auto_open_ticket_forms()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_stage_id UUID;
BEGIN
  IF NEW.capture_channel IS DISTINCT FROM 'forms' THEN
    RETURN NEW;
  END IF;

  -- Intake do CRM externo: quem abre o ticket e escolhe a etapa e a propria RPC
  -- (apply_external_crm_outcome), porque o destino nao e a etapa de formulario.
  IF coalesce(current_setting('app.crm_intake', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tickets WHERE lead_id = NEW.id AND status = 'open') THEN
    RETURN NEW;
  END IF;

  v_stage_id := public.fn_default_entry_stage(NEW.clinic_id, 'forms');

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, NEW.id, v_stage_id, 'open', NOW());

  RETURN NEW;
END;
$function$;

create or replace function public.fn_auto_open_ticket()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_ticket_id UUID;
  v_clinic_id UUID;
  v_capture_channel TEXT;
  v_stage_id  UUID;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.direction = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_ticket_id
  FROM public.tickets
  WHERE lead_id = NEW.lead_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    NEW.ticket_id := v_ticket_id;
  ELSE
    SELECT clinic_id, capture_channel INTO v_clinic_id, v_capture_channel
    FROM public.leads WHERE id = NEW.lead_id;

    -- Mesma regra de antes: canal 'forms' tenta a etapa 'forms', o resto vai para 'whatsapp'.
    v_stage_id := public.fn_default_entry_stage(
      v_clinic_id,
      CASE WHEN v_capture_channel = 'forms' THEN 'forms' ELSE 'whatsapp' END
    );

    INSERT INTO public.tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_clinic_id, NEW.lead_id, v_stage_id, 'open', NOW())
    RETURNING id INTO v_ticket_id;

    NEW.ticket_id := v_ticket_id;
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function public.fn_touchpoint_from_site_form()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(new.capture_channel, '') <> 'forms' then
    return null;
  end if;

  if exists (
    select 1 from public.meta_form_submissions lt
    where lt.clinic_id = new.clinic_id
      and lt.channel = 'meta_forms'
      and (
        (nullif(new.rast_id, '') is not null and lt.rast_id = new.rast_id)
        or (lt.phone_norm is not null and lt.phone_norm = normalize_br_phone(new.phone))
      )
  ) then
    return null;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad,
     campaign_id, adset_id, ad_id, ad_platform, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     'site_forms', new.source,
     coalesce(new.g_campaign_name, new.fb_campaign_name),
     coalesce(new.g_adset_name,   new.fb_adset_name),
     coalesce(new.g_ad_name,      new.fb_ad_name),
     coalesce(new.g_campaign_id,  new.fb_campaign_id),
     coalesce(new.g_adset_id,     new.fb_adset_id),
     coalesce(new.g_ad_id,        new.fb_ad_id),
     new.ad_platform,
     -- O canal continua 'site_forms' (vocabulario fechado, lido por 6 telas e 3 RPCs de painel),
     -- mas o TEXTO deixa de mentir: quem veio do CRM nunca preencheu formulario nenhum.
     case when coalesce(current_setting('app.crm_intake', true), '') = '1'
          then 'Negócio criado no CRM externo'
          else 'Preencheu formulário' end,
     new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$function$;

create or replace function public.fn_reset_followup_on_new_ticket()
returns trigger
language plpgsql
as $function$
BEGIN
  -- Ticket aberto pelo webhook do CRM nao e sinal de que o paciente voltou a falar: nao limpa o
  -- handoff (um humano assumiu a conversa) nem re-arma a regua de follow-up.
  IF coalesce(current_setting('app.crm_intake', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'open' THEN
    -- Handoff: sempre limpo (ticket novo = atendimento novo). Não participa do loop.
    UPDATE public.leads
      SET handoff_triggered_at = NULL
      WHERE id = NEW.lead_id
        AND handoff_triggered_at IS NOT NULL;

    -- A régua só reinicia após a carência (3 dias). Sem isto, responder ao "vou encerrar" abre
    -- ticket novo, zera o contador e a perseguição recomeça do passo 1 (66 leads afetados; o
    -- "Cleberson" levou 7 mensagens em 3 ciclos).
    UPDATE public.leads
      SET followup_count   = 0,
          followup_sent_at = NULL
      WHERE id = NEW.lead_id
        AND (followup_count <> 0 OR followup_sent_at IS NOT NULL)
        AND (
          followup_sent_at IS NULL
          OR followup_sent_at < ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 days')
        );
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 3. A RPC ─────────────────────────────────────────────────────────────────────────────────

create or replace function public.apply_external_crm_outcome(
  p_clinic_id uuid,
  p_outcome text,
  p_phone text,
  p_email text default null,
  p_name text default null,
  p_loss_reason text default null,
  p_source text default null,
  p_campaign text default null,
  p_adset text default null,
  p_ad text default null,
  p_ad_platform text default null,
  p_raw jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_event_id    uuid;
  v_lead_id     uuid;
  v_ticket_id   uuid;
  v_prev_ticket uuid;
  v_stage_id    uuid;
  v_nphone      text;
  v_deal_key    text;
  v_created     boolean := false;
  v_new_tkt     boolean := false;
  v_is_google   boolean := (p_source = 'google_ads');
  v_is_meta     boolean := (p_source IN ('meta_ads','instagram'));
  v_cur_out     text;
  v_fin         jsonb;
BEGIN
  IF p_outcome NOT IN ('ganho','perdido','lead') THEN
    RETURN jsonb_build_object('error','invalid_outcome');
  END IF;

  -- Marca de intake do CRM, lida por 3 triggers. Setada em TODA chamada, inclusive para '0':
  -- um lote que roda varias chamadas na MESMA transacao herdaria o valor da anterior, e ai um
  -- 'ganho' perderia o ticket que o trigger de forms abre para ele.
  PERFORM set_config('app.crm_intake', CASE WHEN p_outcome = 'lead' THEN '1' ELSE '0' END, true);

  INSERT INTO public.external_crm_events (clinic_id, outcome, name, phone, email, loss_reason, raw)
  VALUES (p_clinic_id, p_outcome, p_name, p_phone, p_email, p_loss_reason, p_raw)
  RETURNING id INTO v_event_id;

  v_nphone  := normalize_br_phone(p_phone);
  v_lead_id := public.fn_find_lead_by_identity(p_clinic_id, v_nphone, p_email);

  -- Upsert: sem lead, cria. capture_channel='forms' e mantido de proposito (e o mesmo canal dos
  -- 5.017 leads que o pipeline do CRM ja criou; trocar agora partiria o recorte de canal da clinica
  -- ao meio). Para p_outcome='lead' o auto-open de forms esta suprimido pela marca acima.
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
        p_source, 'forms', NULLIF(trim(p_ad_platform),''),
        CASE WHEN v_is_google THEN p_campaign END, CASE WHEN v_is_google THEN p_adset END, CASE WHEN v_is_google THEN p_ad END,
        CASE WHEN v_is_meta   THEN p_campaign END, CASE WHEN v_is_meta   THEN p_adset END, CASE WHEN v_is_meta   THEN p_ad END
      )
      RETURNING id INTO v_lead_id;

      IF v_lead_id IS NOT NULL THEN
        v_created := true;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Corrida: outro webhook criou o MESMO lead entre o lookup e o insert (o wa-inbound ja
      -- mostrou que essa janela e real). Sem este bloco a excecao subia, e o rollback levava junto
      -- a linha de external_crm_events: o evento sumia da tabela que o monitor de silencio le.
      PERFORM public.log_system_error(
        'apply_external_crm_outcome', 'lead_corrida_unique',
        'Corrida ao criar lead do CRM externo (recuperada, sem perda)', 'warn', p_clinic_id,
        jsonb_build_object('outcome', p_outcome, 'event_id', v_event_id,
                           'tem_telefone', NULLIF(trim(p_phone),'') IS NOT NULL,
                           'tem_email', NULLIF(trim(p_email),'') IS NOT NULL),
        false);
    END;

    -- Reencontra em dois casos: a corrida acima, e a mesclagem silenciosa do
    -- fn_handle_lead_uniqueness (trigger BEFORE INSERT que devolve NULL quando o contato ja existe).
    IF v_lead_id IS NULL THEN
      v_lead_id := public.fn_find_lead_by_identity(p_clinic_id, v_nphone, p_email);
    END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('error','lead_indisponivel','event_id',v_event_id);
  END IF;

  -- ── LEAD NOVO: garante ticket ABERTO e para. Sem desfecho, sem finalize_ticket. ────────────
  IF p_outcome = 'lead' THEN
    SELECT id INTO v_ticket_id FROM public.tickets
     WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;

    IF v_ticket_id IS NULL THEN
      -- Dedup de REPLAY. Sem isto, a sequencia lead -> ganho -> reentrega do lead original abria
      -- um ticket novo num lead ja ganho: o card ressuscitava no Kanban e o funil (que conta por
      -- ticket) contava a mesma pessoa duas vezes. O Clint nao manda deal_id nos webhooks reais
      -- (0 de 74), mas manda deal_created_at em 74 de 74; os outros dois nomes cobrem CRM diferente.
      v_deal_key := NULLIF(trim(COALESCE(p_raw->>'deal_created_at', p_raw->>'deal_id', p_raw->>'id')), '');

      IF v_deal_key IS NOT NULL THEN
        SELECT e.ticket_id INTO v_prev_ticket
          FROM public.external_crm_events e
         WHERE e.clinic_id = p_clinic_id AND e.lead_id = v_lead_id
           AND e.outcome = 'lead' AND e.id <> v_event_id AND e.ticket_id IS NOT NULL
           AND NULLIF(trim(COALESCE(e.raw->>'deal_created_at', e.raw->>'deal_id', e.raw->>'id')), '') = v_deal_key
         ORDER BY e.received_at DESC LIMIT 1;
      ELSE
        -- Sem chave de negocio no payload, so da para barrar o retry imediato.
        SELECT e.ticket_id INTO v_prev_ticket
          FROM public.external_crm_events e
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

      -- DECISAO DO DONO (27/07): lead do CRM entra na etapa WHATSAPP, nao na de formulario.
      v_stage_id := public.fn_default_entry_stage(p_clinic_id, 'whatsapp');

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
        -- uq_tickets_one_open_per_lead: outra rota abriu o ticket no meio do caminho. Usa o dela.
        PERFORM set_config('app.stage_source', '', true);
        SELECT id INTO v_ticket_id FROM public.tickets
         WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
      END;
    END IF;

    UPDATE public.external_crm_events
       SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;

    -- Antes isto devolvia ok:true com ticket_id NULL e ninguem ficava sabendo que o card nao abriu.
    IF v_ticket_id IS NULL THEN
      PERFORM public.log_system_error(
        'apply_external_crm_outcome', 'ticket_nao_aberto',
        'Lead do CRM entrou mas o ticket nao foi aberto (corrida nao resolvida)', 'error', p_clinic_id,
        jsonb_build_object('lead_id', v_lead_id, 'event_id', v_event_id), false);
      RETURN jsonb_build_object('error','ticket_nao_aberto','lead_id',v_lead_id,'event_id',v_event_id);
    END IF;

    -- created_ticket agora responde "o card nasceu neste evento?". Como a marca de intake desliga
    -- o auto-open de forms, o unico jeito de o ticket nascer aqui e pelo INSERT acima.
    RETURN jsonb_build_object('ok',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome','lead',
                              'created_lead',v_created,'created_ticket',v_new_tkt);
  END IF;

  -- Ticket alvo: aberto primeiro; senão o mais recente (finalize_ticket sobrescreve fechado)
  SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
   WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
     WHERE lead_id = v_lead_id ORDER BY opened_at DESC LIMIT 1;
  END IF;

  IF v_ticket_id IS NULL THEN
    UPDATE public.external_crm_events SET lead_id = v_lead_id WHERE id = v_event_id;
    RETURN jsonb_build_object('error','sem_ticket','lead_id',v_lead_id,'event_id',v_event_id);
  END IF;

  -- Idempotência: ticket já está nesse outcome -> não re-finaliza
  IF v_cur_out IS NOT NULL AND v_cur_out = p_outcome THEN
    UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;
    RETURN jsonb_build_object('ok',true,'skipped',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome',p_outcome,'created_lead',v_created);
  END IF;

  v_fin := public.finalize_ticket(v_ticket_id, p_outcome, p_loss_reason, NULL, true);

  UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;

  RETURN jsonb_build_object('ok',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome',p_outcome,'created_lead',v_created,'finalize',v_fin);
END;
$function$;



-- Indice para o dedup de replay (clinic + lead + outcome). O idx_ece_lead sozinho ja serve,
-- mas o parcial deixa a checagem barata quando a tabela crescer com leads diarios.
create index if not exists idx_ece_lead_outcome
  on public.external_crm_events (clinic_id, lead_id, received_at desc)
  where outcome = 'lead';
