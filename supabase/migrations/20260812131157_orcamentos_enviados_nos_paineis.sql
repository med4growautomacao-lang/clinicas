-- ORÇAMENTOS ENVIADOS (quantidade + valor) nos três painéis.
--
-- Fonte única, no mesmo formato das outras v_kpi_*: uma linha por orçamento ENVIADO, com o dia
-- em São Paulo, o valor e os buckets de plataforma/canal do lead. Assim os três painéis leem a
-- MESMA definição, e "enviados" quer dizer a mesma coisa em todo lugar.
--
-- 📌 Eixo = `sent_at` (quando foi enviado), não created_at: orçamento rascunhado num dia e
-- enviado noutro pertence ao dia do envio. Rascunho (sent_at nulo) não conta.
-- 📌 Status NÃO entra no filtro: orçamento aprovado ou recusado também FOI enviado. Contar só
-- status='enviado' faria o número do passado encolher sozinho conforme a clínica fecha negócio.
create or replace view public.v_kpi_quotes as
select
  o.clinic_id,
  o.id        as quote_id,
  o.lead_id,
  o.ticket_id,
  (o.sent_at at time zone 'America/Sao_Paulo')::date as day,
  coalesce(o.total, 0) as value,
  case
    when l.source = 'meta_ads'   then 'meta_ads'
    when l.source = 'google_ads' then 'google_ads'
    else 'no_track'
  end as platform,
  case
    when l.capture_channel = 'forms'  then 'forms'
    when l.capture_channel = 'balcao' then 'balcao'
    else 'whatsapp'
  end as channel
from public.orcamentos o
left join public.leads l on l.id = o.lead_id
where o.sent_at is not null
  and (l.id is null or coalesce(l.is_not_lead, false) = false);

-- ⚠️ security_invoker em comando SEPARADO e SEMPRE: `create or replace view` zera a opção sem
-- avisar, e sem ela a view roda como o dono (postgres) e ignora a RLS de orcamentos.
alter view public.v_kpi_quotes set (security_invoker = on);
revoke all on public.v_kpi_quotes from public, anon;
grant select on public.v_kpi_quotes to authenticated, service_role;

-- ===================== Painéis =====================
-- Mesmo patch ancorado das RPCs grandes (lê a definição viva, troca trechos exatos, falha se
-- alguma âncora tiver mudado). Ver 20260812124821 para o porquê.
do $mig$
declare
  v_def text;
  v_a   text;
  v_b   text;
begin
  -- ---------- Visão Geral ----------
  v_def := pg_get_functiondef('public.get_dashboard_stats_impl(uuid,date,date,text,text,text)'::regprocedure);

  v_a := '  v_total_sales int;';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_dashboard_stats_impl: ancora do DECLARE ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_a || chr(10) || '  v_quotes_sent int; v_quotes_value numeric;');

  v_a := '  SELECT COUNT(*) INTO v_total_leads FROM leads l';
  v_b := '  -- ORÇAMENTOS ENVIADOS: quantidade e valor, pelo dia do envio (v_kpi_quotes).' || chr(10) ||
         '  SELECT COUNT(*), COALESCE(SUM(q.value), 0) INTO v_quotes_sent, v_quotes_value' || chr(10) ||
         '  FROM v_kpi_quotes q LEFT JOIN leads l ON l.id = q.lead_id' || chr(10) ||
         '  WHERE q.clinic_id = p_clinic_id AND q.day BETWEEN p_date_from AND p_date_to' || chr(10) ||
         '    AND (p_origin = ''todos''' || chr(10) ||
         '      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, '','')))' || chr(10) ||
         '    AND (p_channel = ''todos'' OR l.capture_channel = ANY(string_to_array(p_channel, '','')))' || chr(10) ||
         '    AND (p_agent = ''todos'' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));' || chr(10) || chr(10) ||
         v_a;
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_dashboard_stats_impl: ancora do COUNT(leads) ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  v_a := '''totalSales'', v_total_sales,';
  v_b := '''totalSales'', v_total_sales, ''quotesSent'', COALESCE(v_quotes_sent,0), ''quotesValue'', COALESCE(v_quotes_value,0),';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_dashboard_stats_impl: ancora do RETURN ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  execute v_def;

  -- ---------- Resultados (Comercial) ----------
  -- Recorte: janela de CONVERSÃO (é a que manda no dinheiro nesta tela) + coorte de Entrada +
  -- agente/origem/canal. O toggle Ganho/Perdido NÃO entra: orçamento enviado não tem desfecho.
  v_def := pg_get_functiondef('public.get_commercial_dashboard_impl(uuid,date,date,date,date,text,text,text,date,date,text,text)'::regprocedure);

  v_a := 'v_default_ticket numeric;';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_commercial_dashboard_impl: ancora do DECLARE ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_a || ' v_quotes_sent int; v_quotes_value numeric;');

  v_a := '  -- Ciclo: até o Ganho por padrão';
  v_b := '  -- ORÇAMENTOS ENVIADOS: quantidade e valor, pelo dia do envio (v_kpi_quotes).' || chr(10) ||
         '  SELECT COUNT(*), COALESCE(SUM(q.value), 0) INTO v_quotes_sent, v_quotes_value' || chr(10) ||
         '  FROM v_kpi_quotes q LEFT JOIN leads l ON l.id = q.lead_id' || chr(10) ||
         '  WHERE q.clinic_id = p_clinic_id' || chr(10) ||
         '    AND (p_conv_from IS NULL OR q.day >= p_conv_from)' || chr(10) ||
         '    AND (p_conv_to   IS NULL OR q.day <= p_conv_to)' || chr(10) ||
         '    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)' || chr(10) ||
         '    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)' || chr(10) ||
         '    AND (p_agent = ''todos'' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))' || chr(10) ||
         '    AND (p_origin = ''todos''' || chr(10) ||
         '      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, '','')))' || chr(10) ||
         '    AND (p_channel = ''todos'' OR l.capture_channel = ANY(string_to_array(p_channel, '','')));' || chr(10) || chr(10) ||
         v_a;
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_commercial_dashboard_impl: ancora do ciclo ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  v_a := '''defaultTicket'', COALESCE(v_default_ticket,0))';
  v_b := '''defaultTicket'', COALESCE(v_default_ticket,0), ''quotesSent'', COALESCE(v_quotes_sent,0), ''quotesValue'', COALESCE(v_quotes_value,0))';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_commercial_dashboard_impl: ancora do finance ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  execute v_def;
end;
$mig$;

-- ---------- Marketing ----------
-- Mais duas colunas (quotes, quotes_value) na mesma grade dia × plataforma × canal.
drop function if exists public.marketing_kpis(uuid, date, date);
drop function if exists public.marketing_kpis_impl(uuid, date, date);

create function public.marketing_kpis_impl(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, sales bigint, wins bigint, scheduled bigint, quotes bigint, quotes_value numeric)
language sql
stable
set search_path to 'public'
as $function$
  with
  lx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_leads
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  wx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_wins
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  -- sum = valor lançado; count = quantas vendas. Uma CTE só, de propósito.
  sx as (select day, platform, channel, sum(value)::numeric v, count(*)::bigint n from public.v_kpi_sales_value
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  gx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_scheduled
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  -- orçamentos ENVIADOS (day = sent_at em SP): quantidade e valor, mesma lógica do sx.
  qx as (select day, platform, channel, sum(value)::numeric v, count(*)::bigint n from public.v_kpi_quotes
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  keys as (
    select day,platform,channel from lx
    union select day,platform,channel from wx
    union select day,platform,channel from sx
    union select day,platform,channel from gx
    union select day,platform,channel from qx
  )
  select k.day, k.platform, k.channel,
         coalesce(lx.n,0) as leads,
         coalesce(sx.v,0) as conv_value,
         coalesce(sx.n,0) as sales,
         coalesce(wx.n,0) as wins,
         coalesce(gx.n,0) as scheduled,
         coalesce(qx.n,0) as quotes,
         coalesce(qx.v,0) as quotes_value
  from keys k
  left join lx on lx.day=k.day and lx.platform=k.platform and lx.channel=k.channel
  left join wx on wx.day=k.day and wx.platform=k.platform and wx.channel=k.channel
  left join sx on sx.day=k.day and sx.platform=k.platform and sx.channel=k.channel
  left join gx on gx.day=k.day and gx.platform=k.platform and gx.channel=k.channel
  left join qx on qx.day=k.day and qx.platform=k.platform and qx.channel=k.channel;
$function$;

create function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, sales bigint, wins bigint, scheduled bigint, quotes bigint, quotes_value numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_kpis_impl(p_clinic_id, p_start, p_end);
end;
$function$;

revoke all on function public.marketing_kpis_impl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.marketing_kpis(uuid, date, date) from public, anon, authenticated;
grant execute on function public.marketing_kpis_impl(uuid, date, date) to service_role;
grant execute on function public.marketing_kpis(uuid, date, date) to authenticated, service_role;
