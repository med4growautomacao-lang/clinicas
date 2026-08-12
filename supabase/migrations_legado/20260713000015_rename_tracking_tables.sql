-- Renomeia as tabelas de tracking para o que elas de fato fazem.
--
-- Os nomes MENTIAM, e isso já custou tempo de diagnóstico:
--
--   `lead_tracking_inbox` soava como "buffer temporário de processamento". Não é. É a FILA DE
--   RECONCILIAÇÃO: a atribuição e o lead chegam por dois webhooks independentes, sem ordem
--   garantida, e 6,3% dos cliques chegam ANTES do lead existir (espera máxima medida: 7h15). Sem
--   ela, esses 6% viravam lead "sem origem". As linhas ficam para sempre; `consumed_at` é só um
--   marcador. → `attribution_inbox`
--
--   `lead_tracking` soava como "a tabela principal do tracking". Não é. São 15 linhas, e o trabalho
--   dela é ser o LEDGER DE IDEMPOTÊNCIA do poller do Formulário do Meta: o `on conflict (channel,
--   external_id)` é o que impede a mesma submissão de ser reprocessada a cada minuto. É pequena
--   porque é eficaz, não porque é inútil. → `meta_form_submissions`
--
--   `lead_touchpoints` (a jornada) já tem o nome certo e não muda.
--
-- ⚠️ VIEW DE COMPATIBILIDADE: o workflow n8n "Tracking Meta" ainda é o caminho principal de 16
-- instâncias e insere em `lead_tracking_inbox` PELO NOME (29 inserts nas últimas 24h). Renomear a
-- seco derrubaria a atribuição paga de quase todos os clientes. A view mantém o nome antigo vivo,
-- é auto-atualizável (INSERT nela cai na tabela base e dispara os triggers) e sai quando a migração
-- para a edge `ctwa-tracking` terminar em todas as instâncias.
--
-- `security_invoker = true` é obrigatório: sem isso a view rodaria com as permissões do dono e
-- daria um bypass de RLS cross-tenant — o mesmo furo de [[rls-org-tenant-isolation-fix]].
--
-- PRÓXIMO PASSO (já previsto): o tracking do Google (hoje no n8n "webhook_redirecionamento") passa a
-- entrar na `attribution_inbox`. O clique do Google não tem telefone do lead — casa por `rast_id`,
-- que é justamente a coluna que já existe aqui e está zerada. O nome novo comporta isso; o antigo,
-- que falava em "inbox de tracking", já não descrevia nada.

begin;

alter table public.lead_tracking_inbox rename to attribution_inbox;
alter table public.lead_tracking       rename to meta_form_submissions;

comment on table public.attribution_inbox is
  'Fila de reconciliação de atribuição: eventos de clique pago (CTWA hoje, Google em breve) que precisam ser casados a um lead por telefone normalizado ou rast_id. Existe porque o clique e o lead chegam por webhooks independentes, sem ordem garantida.';

comment on table public.meta_form_submissions is
  'Ledger de idempotência do poller do Formulário do Meta (Lead Ads). O unique (channel, external_id) é o que impede a mesma submissão de ser reprocessada a cada minuto pela edge meta-forms-sync.';

-- ---------------------------------------------------------------------------
-- Compatibilidade: o n8n "Tracking Meta" continua inserindo no nome antigo
-- ---------------------------------------------------------------------------
create view public.lead_tracking_inbox
  with (security_invoker = true)
  as select * from public.attribution_inbox;

comment on view public.lead_tracking_inbox is
  'TEMPORÁRIO: nome antigo mantido vivo só para o workflow n8n "Tracking Meta", que insere aqui pelo nome. Remover quando todas as instâncias uazapi estiverem apontando para a edge ctwa-tracking.';

grant select, insert, update, delete on public.lead_tracking_inbox to anon, authenticated, service_role;
grant select on public.lead_tracking_inbox to assistant_ro;

-- O n8n não preenche `external_id` (nem sabe que ele existe), então as linhas dele ficariam fora do
-- índice único e um retry duplicaria o clique. Preencher aqui fecha esse buraco para os dois
-- caminhos de escrita de uma vez.
create or replace function public.fn_attribution_inbox_external_id()
returns trigger
language plpgsql
as $$
begin
  if new.external_id is null then
    new.external_id := new.ctwa_clid;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attribution_inbox_external_id on public.attribution_inbox;
create trigger trg_attribution_inbox_external_id
  before insert on public.attribution_inbox
  for each row execute function public.fn_attribution_inbox_external_id();

-- ---------------------------------------------------------------------------
-- Funções que citam as tabelas pelo nome
--
-- Postgres NÃO reescreve o corpo das funções ao renomear a tabela: o SQL fica gravado como texto e
-- só quebra na hora da execução. Todas as seis precisam ser recriadas junto, na mesma transação.
-- ---------------------------------------------------------------------------

create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.attribution_inbox%rowtype;
begin
  select * into i from public.attribution_inbox where id = p_inbox_id;
  if not found then return; end if;

  update public.leads l set
    source           = coalesce(nullif(l.source, ''),           nullif(i.source, '')),
    ctwa_clid        = coalesce(nullif(l.ctwa_clid, ''),        nullif(i.ctwa_clid, '')),
    fb_clid          = coalesce(nullif(l.fb_clid, ''),          nullif(i.fb_clid, '')),
    g_clid           = coalesce(nullif(l.g_clid, ''),           nullif(i.g_clid, '')),
    fb_campaign_name = coalesce(nullif(l.fb_campaign_name, ''), nullif(i.fb_campaign_name, '')),
    fb_adset_name    = coalesce(nullif(l.fb_adset_name, ''),    nullif(i.fb_adset_name, '')),
    fb_ad_name       = coalesce(nullif(l.fb_ad_name, ''),       nullif(i.fb_ad_name, '')),
    ad_platform      = coalesce(nullif(l.ad_platform, ''),      nullif(i.ad_platform, '')),
    g_campaign_name  = coalesce(nullif(l.g_campaign_name, ''),  nullif(i.g_campaign_name, '')),
    g_adset_name     = coalesce(nullif(l.g_adset_name, ''),     nullif(i.g_adset_name, '')),
    g_ad_name        = coalesce(nullif(l.g_ad_name, ''),        nullif(i.g_ad_name, '')),
    g_term_name      = coalesce(nullif(l.g_term_name, ''),      nullif(i.g_term_name, '')),
    g_source_name    = coalesce(nullif(l.g_source_name, ''),    nullif(i.g_source_name, '')),
    rast_id          = coalesce(nullif(l.rast_id, ''),          nullif(i.rast_id, ''))
  where l.id = p_lead_id;

  update public.attribution_inbox
     set consumed_at = now(), matched_lead_id = p_lead_id
   where id = p_inbox_id;
end;
$function$;

create or replace function public.fn_lead_pull_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inbox_id uuid;
begin
  if (new.source is not null and new.source <> '')
     or new.ctwa_clid is not null
     or new.fb_clid is not null
     or new.g_clid is not null then
    return null;
  end if;

  select id into v_inbox_id
    from public.attribution_inbox
   where clinic_id = new.clinic_id
     and phone_norm = public.normalize_br_phone(new.phone)
     and consumed_at is null
   order by created_at desc
   limit 1;

  if v_inbox_id is not null then
    perform public.fn_apply_inbox_to_lead(new.id, v_inbox_id);
  end if;

  return null;
end;
$function$;

create or replace function public.fn_reconcile_pending_tracking()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT i.id AS inbox_id,
      (SELECT l.id FROM leads l
        WHERE l.clinic_id = i.clinic_id AND normalize_br_phone(l.phone) = i.phone_norm
        ORDER BY l.created_at DESC LIMIT 1) AS lead_id
    FROM attribution_inbox i
    WHERE i.consumed_at IS NULL AND i.phone_norm IS NOT NULL
  LOOP
    IF r.lead_id IS NOT NULL THEN
      PERFORM public.fn_apply_inbox_to_lead(r.lead_id, r.inbox_id);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;

create or replace function public.ctwa_enrich_campaign(
  p_inbox_id  uuid,
  p_campaign  text,
  p_adset     text,
  p_ad        text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.attribution_inbox%rowtype;
begin
  update public.attribution_inbox
     set fb_campaign_name = coalesce(nullif(fb_campaign_name, ''), nullif(p_campaign, '')),
         fb_adset_name    = coalesce(nullif(fb_adset_name, ''),    nullif(p_adset, '')),
         fb_ad_name       = coalesce(nullif(fb_ad_name, ''),       nullif(p_ad, ''))
   where id = p_inbox_id
  returning * into i;

  if not found then return; end if;

  if i.matched_lead_id is not null then
    update public.leads l
       set fb_campaign_name = coalesce(nullif(l.fb_campaign_name, ''), nullif(i.fb_campaign_name, '')),
           fb_adset_name    = coalesce(nullif(l.fb_adset_name, ''),    nullif(i.fb_adset_name, '')),
           fb_ad_name       = coalesce(nullif(l.fb_ad_name, ''),       nullif(i.fb_ad_name, ''))
     where l.id = i.matched_lead_id;
  end if;

  update public.lead_touchpoints t
     set campaign = coalesce(nullif(t.campaign, ''), nullif(i.fb_campaign_name, '')),
         adset    = coalesce(nullif(t.adset, ''),    nullif(i.fb_adset_name, '')),
         ad       = coalesce(nullif(t.ad, ''),       nullif(i.fb_ad_name, ''))
   where t.channel = 'whatsapp'
     and t.external_ref = coalesce(i.external_id, i.ctwa_clid);
end;
$function$;

create or replace function public.fn_touchpoint_from_site_form()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(new.capture_channel, '') <> 'forms' then
    return null;
  end if;

  -- Veio do Formulário Nativo do Meta? Então não é "formulário do site".
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
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     'site_forms', new.source,
     coalesce(new.g_campaign_name, new.fb_campaign_name),
     coalesce(new.g_adset_name,   new.fb_adset_name),
     coalesce(new.g_ad_name,      new.fb_ad_name),
     'Preencheu formulário', new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$function$;

create or replace function public.ingest_meta_form_lead(
  p_clinic_id uuid, p_external_id text, p_name text, p_phone text,
  p_email text default null::text,
  p_submitted_at timestamp with time zone default now(),
  p_campaign_name text default null::text,
  p_adset_name text default null::text,
  p_ad_name text default null::text,
  p_payload jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_track_id uuid;
  v_lead_id  uuid;
  v_nphone   text;
  v_rast     text;
  v_created  boolean := false;
  v_created_sp timestamp := coalesce(
    (p_submitted_at AT TIME ZONE 'America/Sao_Paulo'),
    (now() AT TIME ZONE 'America/Sao_Paulo')
  );
begin
  if p_external_id is null or p_external_id = '' then
    return jsonb_build_object('error', 'external_id obrigatório');
  end if;

  v_nphone := normalize_br_phone(p_phone);

  -- Ledger / idempotência — barra reprocessamento da mesma submissão (o poller relê a lista 1x/min).
  insert into public.meta_form_submissions (
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
      from public.meta_form_submissions
     where channel = 'meta_forms' and external_id = p_external_id;
    return jsonb_build_object('lead_id', v_lead_id, 'created', false, 'duplicate', true);
  end if;

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
      p_campaign_name, p_adset_name, p_ad_name, v_created_sp
    )
    returning id into v_lead_id;

    if v_lead_id is null and v_nphone is not null then
      select id into v_lead_id
        from public.leads
       where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_nphone
       limit 1;
    else
      v_created := true;
    end if;
  else
    update public.leads set
      source           = coalesce(nullif(source, ''),           'meta_ads'),
      fb_campaign_name = coalesce(nullif(fb_campaign_name, ''),  nullif(p_campaign_name, '')),
      fb_adset_name    = coalesce(nullif(fb_adset_name, ''),     nullif(p_adset_name, '')),
      fb_ad_name       = coalesce(nullif(fb_ad_name, ''),        nullif(p_ad_name, '')),
      email            = coalesce(nullif(email, ''),             nullif(p_email, ''))
    where id = v_lead_id;
  end if;

  update public.meta_form_submissions set lead_id = v_lead_id where id = v_track_id;

  return jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'duplicate', false);
end;
$function$;

commit;
