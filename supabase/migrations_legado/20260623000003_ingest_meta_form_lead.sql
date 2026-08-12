-- RPC de ingestão de lead do Formulário Nativo do Meta (Lead Ads).
--
-- Chamada pela Edge Function meta-forms-sync (1 vez por lead retornado pela Graph API). Faz, numa
-- só transação:
--   (1) LEDGER / IDEMPOTÊNCIA: insere a submissão em lead_tracking com ON CONFLICT (channel,
--       external_id) DO NOTHING. external_id = id do lead no Meta. Se já existe -> já processado,
--       devolve o lead vinculado e sai (o poller relê a lista a cada minuto).
--   (2) FIND-OR-CREATE do lead por telefone normalizado:
--         - novo:    rast_id = gen_random_uuid() (mesma técnica/forma do forms do site),
--                    capture_channel='forms', source='meta_ads', created_at = submitted_at.
--                    O trigger trg_auto_open_ticket_forms abre o ticket no Kanban.
--         - existe:  NÃO sobrescreve rast_id/created_at/capture_channel; só completa atribuição
--                    faltante (COALESCE de source/fb_*/email) — DUAL-WRITE p/ os painéis seguirem.
--   (3) Vincula lead_tracking.lead_id ao lead.
--
-- Reusa normalize_br_phone (resolve +55 e 9º dígito). A guarda BEFORE INSERT fn_handle_lead_uniqueness
-- e o índice único por telefone são a rede de segurança contra corrida.

create or replace function public.ingest_meta_form_lead(
  p_clinic_id     uuid,
  p_external_id   text,
  p_name          text,
  p_phone         text,
  p_email         text        default null,
  p_submitted_at  timestamptz default now(),
  p_campaign_name text        default null,
  p_adset_name    text        default null,
  p_ad_name       text        default null,
  p_payload       jsonb       default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_track_id uuid;
  v_lead_id  uuid;
  v_nphone   text;
  v_rast     text;
  v_created  boolean := false;
begin
  if p_external_id is null or p_external_id = '' then
    return jsonb_build_object('error', 'external_id obrigatório');
  end if;

  v_nphone := normalize_br_phone(p_phone);

  -- (1) Ledger / idempotência — barra reprocessamento da mesma submissão.
  insert into public.lead_tracking (
    clinic_id, channel, external_id, name, phone, email,
    source, fb_campaign_name, fb_adset_name, fb_ad_name, submitted_at, payload
  ) values (
    p_clinic_id, 'meta_forms', p_external_id, p_name, p_phone, p_email,
    'meta_ads', p_campaign_name, p_adset_name, p_ad_name, coalesce(p_submitted_at, now()), p_payload
  )
  on conflict (channel, external_id) do nothing
  returning id into v_track_id;

  if v_track_id is null then
    select lead_id into v_lead_id
      from public.lead_tracking
     where channel = 'meta_forms' and external_id = p_external_id;
    return jsonb_build_object('lead_id', v_lead_id, 'created', false, 'duplicate', true);
  end if;

  -- (2) Find-or-create do lead por telefone normalizado.
  if v_nphone is not null and length(v_nphone) >= 12 then
    select id into v_lead_id
      from public.leads
     where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_nphone
     limit 1;
  end if;

  if v_lead_id is null then
    v_rast := gen_random_uuid()::text;
    insert into public.leads (
      clinic_id, name, phone, email, source, capture_channel, rast_id,
      fb_campaign_name, fb_adset_name, fb_ad_name, created_at
    ) values (
      p_clinic_id, coalesce(nullif(p_name, ''), 'Lead Meta'), coalesce(v_nphone, p_phone), p_email,
      'meta_ads', 'forms', v_rast,
      p_campaign_name, p_adset_name, p_ad_name, coalesce(p_submitted_at, now())
    )
    returning id into v_lead_id;

    if v_lead_id is null and v_nphone is not null then
      -- A guarda de unicidade mesclou (RETURN NULL): recupera o lead canônico.
      select id into v_lead_id
        from public.leads
       where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_nphone
       limit 1;
    else
      v_created := true;
    end if;
  else
    -- Lead já existe: dual-write da atribuição (só preenche o que está nulo; não toca em
    -- rast_id/created_at/capture_channel para preservar o first-touch).
    update public.leads set
      source           = coalesce(nullif(source, ''),           'meta_ads'),
      fb_campaign_name = coalesce(nullif(fb_campaign_name, ''),  nullif(p_campaign_name, '')),
      fb_adset_name    = coalesce(nullif(fb_adset_name, ''),     nullif(p_adset_name, '')),
      fb_ad_name       = coalesce(nullif(fb_ad_name, ''),        nullif(p_ad_name, '')),
      email            = coalesce(nullif(email, ''),             nullif(p_email, ''))
    where id = v_lead_id;
  end if;

  -- (3) Vincula o ledger ao lead.
  update public.lead_tracking set lead_id = v_lead_id where id = v_track_id;

  return jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'duplicate', false);
end;
$$;
