-- A regra que traduz leads.source em bucket de ORIGEM estava copiada 47 vezes, em 3 funcoes
-- (get_commercial_dashboard_impl 30, get_dashboard_stats_impl 13, get_commercial_leads_impl 4),
-- com duas grafias (com alias l. e sem alias). Acrescentar uma origem, ou corrigir um bucket,
-- exigia achar as 47; esquecer uma muda um card e deixa os outros, que e exatamente a
-- divergencia de DEFINICAO entre paineis que o CLAUDE.md chama de bug, nao de recorte.
--
-- 📌 A partir daqui a regra mora em fn_lead_origin_bucket e so ali.
--
-- Sem custo: a funcao e SQL puro e IMMUTABLE, entao o planner a EMBUTE. Conferido no plano, que
-- volta a mostrar o CASE original no Filter, nao uma chamada de funcao por linha.
--
-- ⚠️ NAO alinhar estes buckets com a coluna `origin` de v_kpi_investment sem decidir antes: la os
-- valores sao meta_ads/google_ads/no_track, aqui sao meta/google/balcao/sem_origem. Sao vocabularios
-- diferentes de proposito, e "uniformizar" as escondidas troca o significado dos filtros da tela.
create or replace function public.fn_lead_origin_bucket(p_source text)
returns text language sql immutable parallel safe as $$
  select case p_source
           when 'meta_ads'   then 'meta'
           when 'google_ads' then 'google'
           when 'balcao'     then 'balcao'
           else 'sem_origem'
         end
$$;

comment on function public.fn_lead_origin_bucket(text) is
  'Bucket de ORIGEM usado pelos filtros dos paineis (meta/google/balcao/sem_origem). Fonte unica: '
  'era um CASE copiado 47x em 3 RPCs. NAO e o mesmo vocabulario de v_kpi_investment.origin.';

-- Nao e chamada pelo PostgREST; quem chama sao as RPCs (que rodam como owner).
revoke all on function public.fn_lead_origin_bucket(text) from public, anon, authenticated;

do $$
declare
  f text; src text; novo text; n1 int; n2 int; total int := 0;
  com_alias constant text := '(CASE WHEN l.source = ''meta_ads'' THEN ''meta'' WHEN l.source = ''google_ads'' THEN ''google'' WHEN l.source = ''balcao'' THEN ''balcao'' ELSE ''sem_origem'' END)';
  sem_alias constant text := '(CASE WHEN source = ''meta_ads'' THEN ''meta'' WHEN source = ''google_ads'' THEN ''google'' WHEN source = ''balcao'' THEN ''balcao'' ELSE ''sem_origem'' END)';
begin
  foreach f in array array['get_dashboard_stats_impl','get_commercial_dashboard_impl','get_commercial_leads_impl'] loop
    select pg_get_functiondef(p.oid) into src from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname=f;
    n1 := (length(src)-length(replace(src,com_alias,'')))/length(com_alias);
    n2 := (length(src)-length(replace(src,sem_alias,'')))/length(sem_alias);
    if n1 + n2 = 0 then raise exception 'nenhuma copia da regra de origem encontrada em %', f; end if;

    novo := replace(src, com_alias, 'public.fn_lead_origin_bucket(l.source)');
    novo := replace(novo, sem_alias, 'public.fn_lead_origin_bucket(source)');

    -- Fail-closed: nao pode sobrar copia nenhuma, senao ficam duas definicoes vivas ao mesmo tempo.
    if position('sem_origem' in novo) > 0 then
      raise exception 'sobrou copia da regra de origem em %', f;
    end if;
    total := total + n1 + n2;
    execute novo;
  end loop;
  if total <> 47 then raise exception 'esperava 47 copias no total, troquei %', total; end if;
end $$;

revoke all on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;
