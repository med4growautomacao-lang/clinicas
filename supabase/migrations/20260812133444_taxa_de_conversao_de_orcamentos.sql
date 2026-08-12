-- TAXA DE CONVERSÃO DE ORÇAMENTOS EM VENDAS.
--
-- Definição: dos orçamentos ENVIADOS no período, quantos viraram venda. Coorte pelo ENVIO (o
-- mesmo eixo do card de orçamentos), então numerador e denominador falam do mesmo conjunto —
-- "aprovados no mês ÷ enviados no mês" misturaria orçamento de maio aprovado em agosto.
--
-- 📌 "Virou venda" = aprovação formal na Central (conversion_id) OU o CARD do orçamento terminar
-- ganho. Medido em 12/08: 3 orçamentos têm aprovação formal e 10 têm card ganho, e os 3 estão
-- dentro dos 10. Usar só a aprovação formal mostraria 3% numa base onde 10% converteu, porque o
-- botão "Aprovar orçamento" nasceu em 11/08 e a equipe fechava venda pelo Kanban.
--
-- ⚠️ É o estado ATUAL do card: reabrir um card ganho derruba a taxa do mês passado. É o preço de
-- não guardar histórico de desfecho por orçamento, e é coerente com o resto dos painéis
-- (tickets.outcome é a fonte única de venda).
-- ⚠️ Orçamento recém-enviado ainda não teve tempo de fechar: no mês corrente a taxa nasce baixa
-- e sobe. Por isso o front sempre mostra "X de Y", nunca a porcentagem sozinha.
--
-- ⚠️ `won` entra no FIM da lista de colunas: `create or replace view` não deixa inserir coluna no
-- meio (renomearia as seguintes e o comando falha).
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
  end as channel,
  (o.conversion_id is not null or t.outcome = 'ganho') as won
from public.orcamentos o
left join public.leads l   on l.id = o.lead_id
left join public.tickets t on t.id = o.ticket_id
where o.sent_at is not null
  and (l.id is null or coalesce(l.is_not_lead, false) = false);

-- ⚠️ `create or replace view` ZERA security_invoker sem avisar: sem esta linha a view voltaria a
-- rodar como o dono e ignoraria a RLS de orcamentos.
alter view public.v_kpi_quotes set (security_invoker = on);
revoke all on public.v_kpi_quotes from public, anon;
grant select on public.v_kpi_quotes to authenticated, service_role;

do $mig$
declare
  v_def text;
  v_a   text;
  v_b   text;
  v_fn  text;
begin
  foreach v_fn in array array[
    'public.get_dashboard_stats_impl(uuid,date,date,text,text,text)',
    'public.get_commercial_dashboard_impl(uuid,date,date,date,date,text,text,text,date,date,text,text)'
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);

    v_a := 'v_quotes_sent int; v_quotes_value numeric;';
    if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
      raise exception '%: ancora do DECLARE ausente ou repetida — nada aplicado', v_fn;
    end if;
    v_def := replace(v_def, v_a, v_a || ' v_quotes_won int;');

    -- Mesmo SELECT do card de orçamentos ganha o FILTER: numerador e denominador saem juntos,
    -- com recorte idêntico. Contas separadas divergiriam no primeiro que alguém editasse.
    v_a := '  SELECT COUNT(*), COALESCE(SUM(q.value), 0) INTO v_quotes_sent, v_quotes_value';
    v_b := '  SELECT COUNT(*), COALESCE(SUM(q.value), 0), COUNT(*) FILTER (WHERE q.won) INTO v_quotes_sent, v_quotes_value, v_quotes_won';
    if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
      raise exception '%: ancora do SELECT de orcamentos ausente ou repetida — nada aplicado', v_fn;
    end if;
    v_def := replace(v_def, v_a, v_b);

    v_a := '''quotesSent'', COALESCE(v_quotes_sent,0), ''quotesValue'', COALESCE(v_quotes_value,0)';
    v_b := v_a || ', ''quotesWon'', COALESCE(v_quotes_won,0)';
    if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
      raise exception '%: ancora do RETURN ausente ou repetida — nada aplicado', v_fn;
    end if;
    v_def := replace(v_def, v_a, v_b);

    execute v_def;
  end loop;
end;
$mig$;

-- Marketing: mais uma coluna na mesma grade dia × plataforma × canal.
drop function if exists public.marketing_kpis(uuid, date, date);
drop function if exists public.marketing_kpis_impl(uuid, date, date);

create function public.marketing_kpis_impl(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, sales bigint, wins bigint, scheduled bigint, quotes bigint, quotes_value numeric, quotes_won bigint)
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
  -- orçamentos ENVIADOS (day = sent_at em SP): quantidade, valor e quantos viraram venda.
  qx as (select day, platform, channel, sum(value)::numeric v, count(*)::bigint n,
                count(*) filter (where won)::bigint g
         from public.v_kpi_quotes
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
         coalesce(qx.v,0) as quotes_value,
         coalesce(qx.g,0) as quotes_won
  from keys k
  left join lx on lx.day=k.day and lx.platform=k.platform and lx.channel=k.channel
  left join wx on wx.day=k.day and wx.platform=k.platform and wx.channel=k.channel
  left join sx on sx.day=k.day and sx.platform=k.platform and sx.channel=k.channel
  left join gx on gx.day=k.day and gx.platform=k.platform and gx.channel=k.channel
  left join qx on qx.day=k.day and qx.platform=k.platform and qx.channel=k.channel;
$function$;

create function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, sales bigint, wins bigint, scheduled bigint, quotes bigint, quotes_value numeric, quotes_won bigint)
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
