-- get_commercial_leads (lista de leads do painel Comercial): fecha vazamento de PII para anon.
--
-- Encontrada varrendo a mesma classe de furo das migrations irmãs de hoje (RPC SECURITY DEFINER com
-- p_clinic_id e sem guard de tenant). É a mais séria das três, porque o que sai não é agregado:
--
--   role anon (SEM LOGIN), contra a clínica "Intubação":
--     get_commercial_leads(<intubacao>, '2026-07-01','2026-07-26', ...) devolveu
--       total = 742  e  rows[] com name, phone, source, outcome, estimatedValue, apptDate, ...
--
-- Ou seja: nome e TELEFONE de paciente, de qualquer clínica, para quem tiver só a anon key (que é
-- pública, vai no bundle do front). E p_limit/p_offset são parâmetros, então os 742 saem paginados.
-- As agregadas (get_dashboard_stats/get_commercial_dashboard) vazavam número; esta vaza gente.
--
-- Mesmo conserto das irmãs: corpo intocado em _impl, wrapper com assert_clinic_access, anon perde
-- EXECUTE. Nada no banco chama get_commercial_leads (verificado em pg_proc.prosrc) e no front só a
-- lista do Comercial chama, sempre autenticada — o wrapper mantém nome, assinatura e defaults.

alter function public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text)
  rename to get_commercial_leads_impl;

create or replace function public.get_commercial_leads(
  p_clinic_id uuid,
  p_entry_from date,
  p_entry_to date,
  p_conv_from date,
  p_conv_to date,
  p_agent text default 'todos'::text,
  p_origin text default 'todos'::text,
  p_limit integer default 20,
  p_offset integer default 0,
  p_channel text default 'todos'::text,
  p_metric text default 'todos'::text,
  p_agenda_from date default null::date,
  p_agenda_to date default null::date,
  p_sort text default 'entrada'::text,
  p_sort_dir text default 'desc'::text,
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
  perform public.assert_clinic_access(p_clinic_id);
  return public.get_commercial_leads_impl(
    p_clinic_id, p_entry_from, p_entry_to, p_conv_from, p_conv_to,
    p_agent, p_origin, p_limit, p_offset, p_channel, p_metric,
    p_agenda_from, p_agenda_to, p_sort, p_sort_dir, p_outcome, p_loss_reasons
  );
end;
$function$;

revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from anon, authenticated;
revoke all on function public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from anon;
grant execute on function public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) to authenticated, service_role;

comment on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) is
  'Corpo real de get_commercial_leads. NAO chamar direto: SECURITY DEFINER sem guard de tenant, e devolve PII (name/phone). Entrar pelo wrapper get_commercial_leads().';
