-- 20260714201446_google_tracking_inbox_por_protocolo
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ver supabase/migrations/20260714000013_google_tracking_inbox_por_protocolo.sql
-- O clique do site deixa de virar LEAD placeholder e passa a virar linha na attribution_inbox,
-- com o PROTOCOLO como chave. Mata o lead-fantasma (raiz da colisão e da duplicata) e ganha
-- last-touch de graça (o n8n congelava a atribuição no 1o clique: o no "If" nao fazia nada
-- quando o lead ja existia).
-- Roda em PARALELO com o n8n sem conflito: o site chama UMA URL so.

alter table public.attribution_inbox alter column phone drop not null;
alter table public.attribution_inbox add column if not exists protocolo text;

comment on column public.attribution_inbox.protocolo is
  'Codigo devolvido ao site e embutido na 1a mensagem do WhatsApp ("[Protocolo N]"). E a chave de reconciliacao do clique de SITE — no CTWA quem casa e o telefone, aqui e isto.';

create unique index if not exists uq_attribution_inbox_protocolo
  on public.attribution_inbox (clinic_id, protocolo)
  where protocolo is not null;

create index if not exists idx_attribution_inbox_protocolo_aberto
  on public.attribution_inbox (clinic_id, protocolo)
  where protocolo is not null and consumed_at is null;

create or replace function public.site_ingest_click(
  p_clinic_id  uuid,
  p_source     text,
  p_g_clid     text default null,
  p_fb_clid    text default null,
  p_campaign   text default null,
  p_adset      text default null,
  p_ad         text default null,
  p_term       text default null,
  p_utm_source text default null,
  p_rast_id    text default null,
  p_raw        jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proto text;
  v_try   int := 0;
begin
  if p_clinic_id is null then
    raise exception 'clinic_id obrigatorio';
  end if;

  loop
    v_try := v_try + 1;
    v_proto := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');

    begin
      insert into public.attribution_inbox (
        clinic_id, phone, protocolo, source,
        g_clid, fb_clid,
        g_campaign_name, g_adset_name, g_ad_name, g_term_name, g_source_name,
        rast_id, raw, occurred_at, external_id
      ) values (
        p_clinic_id, null, v_proto, nullif(p_source, ''),
        nullif(p_g_clid, ''), nullif(p_fb_clid, ''),
        nullif(p_campaign, ''), nullif(p_adset, ''), nullif(p_ad, ''), nullif(p_term, ''),
        nullif(p_utm_source, ''),
        nullif(p_rast_id, ''), coalesce(p_raw, '{}'::jsonb), now(),
        'proto:' || v_proto
      );
      return v_proto;

    exception when unique_violation then
      if v_try >= 5 then
        raise exception 'nao consegui gerar protocolo unico apos % tentativas', v_try;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.site_ingest_click(uuid, text, text, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.site_ingest_click(uuid, text, text, text, text, text, text, text, text, text, jsonb) to service_role;

create or replace function public.fn_close_site_protocol()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proto text;
  v_inbox uuid;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null or new.clinic_id is null then
    return new;
  end if;

  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*([0-9]{4,})'))[1];
  if v_proto is null then
    return new;
  end if;

  select i.id into v_inbox
  from public.attribution_inbox i
  where i.clinic_id = new.clinic_id
    and i.protocolo = v_proto
    and i.consumed_at is null
    and i.created_at > now() - interval '7 days'
  order by i.created_at desc
  limit 1;

  if v_inbox is null then
    return new;
  end if;

  perform public.fn_apply_inbox_to_lead(new.lead_id, v_inbox);

  return new;
end;
$$;

drop trigger if exists trg_close_site_protocol on public.chat_messages;
create trigger trg_close_site_protocol
  after insert on public.chat_messages
  for each row
  execute function public.fn_close_site_protocol();
