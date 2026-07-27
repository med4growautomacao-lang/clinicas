-- Painéis Visão Geral e Comercial: fecha vazamento cross-tenant nas RPCs SECURITY DEFINER.
--
-- FURO (verificado no banco em 26/07, não é teórico):
-- get_dashboard_stats e get_commercial_dashboard são SECURITY DEFINER e NÃO tinham nenhuma
-- checagem de acesso — confiavam só no p_clinic_id que o cliente manda. Como DEFINER roda como
-- `postgres` (dono das tabelas), a RLS é ignorada. Qualquer chamador podia ler qualquer clínica:
--
--   * gestor de OUTRA organização, contra a clínica "Intubação":
--       select count(*) from leads where clinic_id = <intubacao>  ->      0   (RLS barra, correto)
--       get_dashboard_stats(<intubacao>, ...) -> 'totalLeads'     ->  5.540   (vazou)
--   * pior, `anon` tinha EXECUTE: SEM LOGIN algum, get_dashboard_stats(<intubacao>) devolveu 741
--     leads. A anon key é pública (vai no bundle do front), então bastava a chave + um clinic_id.
--
-- É o mesmo tipo de bypass cross-org que o is_admin() causava e que foi trocado em ~29 policies em
-- 24/06 — as RPCs de painel em DEFINER ficaram fora daquela varredura, porque a RLS nem é
-- consultada no caminho delas.
--
-- FORMA DO CONSERTO — rename + wrapper:
-- get_commercial_dashboard tem ~44 mil caracteres e get_dashboard_stats ~14 mil. Reescrever esses
-- corpos só para enfiar um IF no começo seria arriscar a lógica de KPI de dois painéis por um
-- ganho zero. Então o corpo é renomeado para _impl e fica INTOCADO; o wrapper novo valida acesso e
-- delega. Nenhum número de painel muda.
--
-- Guard: has_clinic_access(p_clinic_id) — a régua já existente da casa (clinic_user daquela clínica
-- com clínica ativa OU membro da organização dona OU is_clinic_admin). Recebe o PARÂMETRO, então
-- roda 1x por chamada e não pesa. Ver a migration irmã (marketing_rpcs_definer_guard) para o porquê
-- de NÃO usar is_clinic_admin() sozinho: ele excluiria o `gestor` de clinic_users.
--
-- _impl segue DEFINER (era o que já era, e é o que mantém o painel rápido), mas perde EXECUTE de
-- anon/authenticated — o wrapper alcança por ser DEFINER. anon perde acesso ao wrapper também:
-- só o front chama essas duas RPCs (useSupabase.ts e ComercialDashboard.tsx), sempre autenticado.

-- 1. get_dashboard_stats (Visão Geral) ----------------------------------------
alter function public.get_dashboard_stats(uuid, date, date, text, text, text)
  rename to get_dashboard_stats_impl;

create or replace function public.get_dashboard_stats(
  p_clinic_id uuid,
  p_date_from date,
  p_date_to date,
  p_origin text default 'todos'::text,
  p_channel text default 'todos'::text,
  p_agent text default 'todos'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return public.get_dashboard_stats_impl(p_clinic_id, p_date_from, p_date_to, p_origin, p_channel, p_agent);
end;
$function$;

-- 2. get_commercial_dashboard (Comercial) -------------------------------------
alter function public.get_commercial_dashboard(uuid, date, date, date, date, text, text, text, date, date, text, text)
  rename to get_commercial_dashboard_impl;

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
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
  return public.get_commercial_dashboard_impl(
    p_clinic_id, p_entry_from, p_entry_to, p_agenda_from, p_agenda_to,
    p_agent, p_origin, p_channel, p_conv_from, p_conv_to, p_outcome, p_loss_reasons
  );
end;
$function$;

-- Grants ----------------------------------------------------------------------
revoke all on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) from anon, authenticated;
revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from anon, authenticated;

revoke all on function public.get_dashboard_stats(uuid, date, date, text, text, text) from anon;
revoke all on function public.get_commercial_dashboard(uuid, date, date, date, date, text, text, text, date, date, text, text) from anon;

grant execute on function public.get_dashboard_stats(uuid, date, date, text, text, text) to authenticated, service_role;
grant execute on function public.get_commercial_dashboard(uuid, date, date, date, date, text, text, text, date, date, text, text) to authenticated, service_role;

comment on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) is
  'Corpo real de get_dashboard_stats. NAO chamar direto: SECURITY DEFINER sem guard de tenant. Entrar pelo wrapper get_dashboard_stats().';
comment on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) is
  'Corpo real de get_commercial_dashboard. NAO chamar direto: SECURITY DEFINER sem guard de tenant. Entrar pelo wrapper get_commercial_dashboard().';
