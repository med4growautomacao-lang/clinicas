-- Guard de tenant das RPCs de painel: centraliza a régua e para de barrar o BACKEND.
--
-- POR QUE ESTA MIGRATION EXISTE (bug introduzido pelas duas migrations anteriores, de hoje):
-- o guard `if not has_clinic_access(p_clinic_id) then raise` estava certo para o navegador e ERRADO
-- para o banco. has_clinic_access se apoia em auth.uid(), que é NULL quando não há JWT de usuário —
-- ou seja, em toda chamada interna:
--
--   cron 21 (`5 * * * *`) -> run_scheduled_reports() -> build_commercial_report()
--     -> get_commercial_dashboard()  [4 chamadas: geral, período anterior, 'ia', 'humano']
--
-- Com o guard cru, o relatório comercial automático (o que é enviado pelo WhatsApp da ORG) passaria
-- a estourar 'acesso negado' de hora em hora. Foi pego antes do disparo das 19:05; nenhum relatório
-- chegou a falhar.
--
-- RÉGUA CORRETA — quem é barrado é o tráfego de usuário final, não o backend:
--   * JWT com role 'anon' ou 'authenticated' (PostgREST, o navegador)  -> exige has_clinic_access
--   * service_role, pg_cron, chamada de dentro do banco (sem JWT)      -> passa, como sempre passou
-- service_role já tem acesso irrestrito ao banco por definição, então barrá-lo não somava segurança
-- nenhuma — só quebrava função interna.
--
-- Vale reparar: o anon é barrado por DOIS mecanismos independentes — perdeu EXECUTE nos wrappers
-- (migrations irmãs) e cai no `v_jwt_role in ('anon','authenticated')` aqui. Um não substitui o
-- outro: o REVOKE é a porta trancada, o guard é o que impede que um GRANT descuidado no futuro
-- reabra o vazamento em silêncio.
--
-- A régua vive numa função só (assert_clinic_access) em vez de copiada em 8 wrappers: se ela mudar,
-- muda num lugar. Os 8 wrappers passam a chamá-la.

create or replace function public.assert_clinic_access(p_clinic_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  -- nullif antes do cast: sem JWT o setting vem NULL ou '', e ''::jsonb seria erro de sintaxe.
  v_jwt_role text := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role',
    ''
  );
begin
  if v_jwt_role in ('anon', 'authenticated') and not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
end;
$function$;

comment on function public.assert_clinic_access(uuid) is
  'Guard de tenant das RPCs de painel (SECURITY DEFINER, que ignoram RLS). Barra JWT anon/authenticated sem has_clinic_access; libera service_role/pg_cron/chamada interna. Levanta 42501 (PostgREST -> 403).';

revoke all on function public.assert_clinic_access(uuid) from anon;
grant execute on function public.assert_clinic_access(uuid) to authenticated, service_role;

-- Os 8 wrappers passam a usar o helper. Corpo de cada RPC segue nos _impl, intocado.

create or replace function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, wins bigint, scheduled bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_kpis_impl(p_clinic_id, p_start, p_end);
end;
$function$;

create or replace function public.marketing_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
returns table(stage_id uuid, platform text, channel text, entry_date date, leads bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_funnel_cohort_impl(p_clinic_id, p_start, p_end);
end;
$function$;

create or replace function public.marketing_utm_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
returns table(stage_id uuid, platform text, channel text, loss_reason text, utm_source text, utm_campaign text, utm_adset text, utm_ad text, utm_term text, entry_date date, leads bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_utm_funnel_cohort_impl(p_clinic_id, p_start, p_end);
end;
$function$;

create or replace function public.marketing_campaign_investment(p_clinic_id uuid, p_start date, p_end date)
returns table(campaign_name text, adset_name text, ad_name text, platform text, investment numeric, leads bigint, wins bigint, losses bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_campaign_investment_impl(p_clinic_id, p_start, p_end);
end;
$function$;

create or replace function public.marketing_campaign_platform_split(p_clinic_id uuid, p_start date, p_end date)
returns table(campaign_name text, ad_platform text, investment numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_campaign_platform_split_impl(p_clinic_id, p_start, p_end);
end;
$function$;

create or replace function public.marketing_loss_reasons(p_clinic_id uuid, p_start date, p_end date)
returns table(campaign_name text, platform text, loss_reason text, losses bigint, campaign_investment numeric, campaign_leads bigint, campaign_losses bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_loss_reasons_impl(p_clinic_id, p_start, p_end);
end;
$function$;

create or replace function public.get_dashboard_stats(
  p_clinic_id uuid,
  p_date_from date,
  p_date_to date,
  p_origin text default 'todos'::text,
  p_channel text default 'todos'::text,
  p_agent text default 'todos'::text
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return public.get_dashboard_stats_impl(p_clinic_id, p_date_from, p_date_to, p_origin, p_channel, p_agent);
end;
$function$;

create or replace function public.get_commercial_dashboard(
  p_clinic_id uuid,
  p_entry_from date,
  p_entry_to date,
  p_agenda_from date,
  p_agenda_to date,
  p_agent text default 'todos'::text,
  p_origin text default 'todos'::text,
  p_channel text default 'todos'::text,
  p_conv_from date default null::date,
  p_conv_to date default null::date,
  p_outcome text default 'ambos'::text,
  p_loss_reasons text default null::text
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return public.get_commercial_dashboard_impl(
    p_clinic_id, p_entry_from, p_entry_to, p_agenda_from, p_agenda_to,
    p_agent, p_origin, p_channel, p_conv_from, p_conv_to, p_outcome, p_loss_reasons
  );
end;
$function$;
