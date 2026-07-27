-- Marketing: RPCs do painel viram SECURITY DEFINER com guard de acesso explícito.
--
-- PROBLEMA (medido 26/07 na clínica "Intubação", 8.236 leads / 13.980 lead_stage_history):
-- as 6 RPCs do painel Marketing eram as ÚNICAS de painel em SECURITY INVOKER — get_dashboard_stats
-- e get_commercial_dashboard já eram DEFINER. Rodando como `authenticated`, cada linha lida pagava
-- a RLS de leads/tickets/lead_stage_history, e essas policies chamam is_clinic_active(clinic_id) e
-- is_clinic_admin(clinic_id) passando a COLUNA — o que impede o planner de resolver uma vez
-- (InitPlan) e força UMA CHAMADA POR LINHA. is_clinic_active é plpgsql: 194 ms para 8.236 chamadas.
-- Pior, leads e lead_stage_history têm DUAS policies OR'd (_all + _org_access) e cada uma repete o
-- par de funções, dobrando o trabalho.
--
-- Custo medido de marketing_kpis na mesma janela: 44 ms como service_role x 2.328 ms como
-- authenticated (53x). Somando as 4 RPCs que a tela dispara: 8.371 ms — acima do statement_timeout
-- de 8s do role `authenticated`. Resultado: HTTP 500 em todas e o painel pintando "SEM DADOS"
-- (nao era lentidao, era timeout). Em dev o StrictMode dobra os efeitos e manda 8 requisições.
--
-- FORMA DO CONSERTO — rename + wrapper, de propósito:
-- o corpo de cada RPC fica INTOCADO (renomeado para _impl). O wrapper novo só valida acesso e
-- delega. Nenhuma regra de KPI é reescrita aqui, então não há risco de alterar número de painel —
-- as definições canônicas (views v_kpi_*) seguem sendo a fonte única.
--
-- SEGURANÇA — o guard não é opcional:
-- virar DEFINER sem guard abriria vazamento cross-tenant (é exatamente o furo que existe hoje em
-- get_dashboard_stats/get_commercial_dashboard, corrigido na migration irmã). Usamos a régua já
-- existente da casa, has_clinic_access(p_clinic_id): clinic_user daquela clínica (+ clínica ativa)
-- OU membro da organização dona da clínica OU is_clinic_admin. Chamada com o PARÂMETRO (não com a
-- coluna), roda 1x por query — custo irrelevante.
--   * NÃO usar is_clinic_admin() sozinho como guard: ele cobre super-admin e membro de org, mas NÃO
--     o `gestor` de clinic_users, que é justamente quem mais abre o painel — derrubaria a tela deles.
--   * _impl fica SECURITY INVOKER: chamado de dentro do wrapper DEFINER o current_user já é o dono
--     (postgres) e a RLS não pesa; mas se alguém chamar _impl direto, a RLS ainda protege.
--   * EXECUTE de _impl é revogado de anon/authenticated (o wrapper alcança por ser DEFINER).
--   * anon perde EXECUTE nos wrappers: 5 das 6 tinham grant a anon. Era inofensivo enquanto INVOKER
--     (a RLS barrava); com DEFINER viraria furo NÃO AUTENTICADO. Só o front chama essas RPCs, e
--     sempre logado.

-- 1. marketing_kpis -----------------------------------------------------------
alter function public.marketing_kpis(uuid, date, date) rename to marketing_kpis_impl;

create or replace function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, wins bigint, scheduled bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return query select * from public.marketing_kpis_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- 2. marketing_funnel_cohort --------------------------------------------------
alter function public.marketing_funnel_cohort(uuid, date, date) rename to marketing_funnel_cohort_impl;

create or replace function public.marketing_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
returns table(stage_id uuid, platform text, channel text, entry_date date, leads bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return query select * from public.marketing_funnel_cohort_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- 3. marketing_utm_funnel_cohort ----------------------------------------------
-- ORDER BY determinístico vive no _impl (migration marketing_utm_funnel_cohort_ordered) e é
-- preservado: o wrapper faz `select *` sem reordenar, e a paginação por .range() do hook
-- useUtmFunnelCohort continua estável.
alter function public.marketing_utm_funnel_cohort(uuid, date, date) rename to marketing_utm_funnel_cohort_impl;

create or replace function public.marketing_utm_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
returns table(stage_id uuid, platform text, channel text, loss_reason text, utm_source text, utm_campaign text, utm_adset text, utm_ad text, utm_term text, entry_date date, leads bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return query select * from public.marketing_utm_funnel_cohort_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- 4. marketing_campaign_investment --------------------------------------------
alter function public.marketing_campaign_investment(uuid, date, date) rename to marketing_campaign_investment_impl;

create or replace function public.marketing_campaign_investment(p_clinic_id uuid, p_start date, p_end date)
returns table(campaign_name text, adset_name text, ad_name text, platform text, investment numeric, leads bigint, wins bigint, losses bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return query select * from public.marketing_campaign_investment_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- 5. marketing_campaign_platform_split ----------------------------------------
alter function public.marketing_campaign_platform_split(uuid, date, date) rename to marketing_campaign_platform_split_impl;

create or replace function public.marketing_campaign_platform_split(p_clinic_id uuid, p_start date, p_end date)
returns table(campaign_name text, ad_platform text, investment numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return query select * from public.marketing_campaign_platform_split_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- 6. marketing_loss_reasons ---------------------------------------------------
alter function public.marketing_loss_reasons(uuid, date, date) rename to marketing_loss_reasons_impl;

create or replace function public.marketing_loss_reasons(p_clinic_id uuid, p_start date, p_end date)
returns table(campaign_name text, platform text, loss_reason text, losses bigint, campaign_investment numeric, campaign_leads bigint, campaign_losses bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return query select * from public.marketing_loss_reasons_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- Grants ----------------------------------------------------------------------
-- _impl: fora do alcance do cliente. O wrapper chega nele por ser DEFINER.
revoke all on function public.marketing_kpis_impl(uuid, date, date)                    from anon, authenticated;
revoke all on function public.marketing_funnel_cohort_impl(uuid, date, date)           from anon, authenticated;
revoke all on function public.marketing_utm_funnel_cohort_impl(uuid, date, date)       from anon, authenticated;
revoke all on function public.marketing_campaign_investment_impl(uuid, date, date)     from anon, authenticated;
revoke all on function public.marketing_campaign_platform_split_impl(uuid, date, date) from anon, authenticated;
revoke all on function public.marketing_loss_reasons_impl(uuid, date, date)            from anon, authenticated;

-- wrappers: só authenticated (o guard decide de qual clínica). anon fora.
revoke all on function public.marketing_kpis(uuid, date, date)                    from anon;
revoke all on function public.marketing_funnel_cohort(uuid, date, date)           from anon;
revoke all on function public.marketing_utm_funnel_cohort(uuid, date, date)       from anon;
revoke all on function public.marketing_campaign_investment(uuid, date, date)     from anon;
revoke all on function public.marketing_campaign_platform_split(uuid, date, date) from anon;
revoke all on function public.marketing_loss_reasons(uuid, date, date)            from anon;

grant execute on function public.marketing_kpis(uuid, date, date)                    to authenticated, service_role;
grant execute on function public.marketing_funnel_cohort(uuid, date, date)           to authenticated, service_role;
grant execute on function public.marketing_utm_funnel_cohort(uuid, date, date)       to authenticated, service_role;
grant execute on function public.marketing_campaign_investment(uuid, date, date)     to authenticated, service_role;
grant execute on function public.marketing_campaign_platform_split(uuid, date, date) to authenticated, service_role;
grant execute on function public.marketing_loss_reasons(uuid, date, date)            to authenticated, service_role;

comment on function public.marketing_kpis_impl(uuid, date, date) is
  'Corpo real de marketing_kpis. NAO chamar direto: sem guard de tenant. Entrar pelo wrapper marketing_kpis().';
comment on function public.marketing_funnel_cohort_impl(uuid, date, date) is
  'Corpo real de marketing_funnel_cohort. NAO chamar direto: sem guard de tenant.';
comment on function public.marketing_utm_funnel_cohort_impl(uuid, date, date) is
  'Corpo real de marketing_utm_funnel_cohort. NAO chamar direto: sem guard de tenant.';
comment on function public.marketing_campaign_investment_impl(uuid, date, date) is
  'Corpo real de marketing_campaign_investment. NAO chamar direto: sem guard de tenant.';
comment on function public.marketing_campaign_platform_split_impl(uuid, date, date) is
  'Corpo real de marketing_campaign_platform_split. NAO chamar direto: sem guard de tenant.';
comment on function public.marketing_loss_reasons_impl(uuid, date, date) is
  'Corpo real de marketing_loss_reasons. NAO chamar direto: sem guard de tenant.';
