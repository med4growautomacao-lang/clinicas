-- Mesmo defeito das outras duas, aqui ainda pequeno (pior caso medido: 522 ms em 06/08/2026).
-- Corrigido junto para nao voltar a crescer com o historico. As outras duas RPCs de Marketing
-- (marketing_funnel_cohort_impl e marketing_utm_funnel_cohort_impl) ficam como estao DE PROPOSITO:
-- ali o ::date cai sobre max(h.changed_at), que e valor AGREGADO de CTE, nao coluna de tabela.
-- Indice nao alcanca isso, entao a troca so daria trabalho sem ganho nenhum.
do $$
declare f text; src text; novo text; trecho text := 'and l.created_at::date between p_start and p_end';
begin
  foreach f in array array['marketing_campaign_investment_impl','marketing_loss_reasons_impl'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=f;
    if position(trecho in src) = 0 then
      raise exception 'Trecho esperado nao encontrado em %', f;
    end if;
    novo := replace(src, trecho,
      'and l.created_at >= p_start::timestamp and l.created_at < (p_end + 1)::timestamp');
    execute novo;
  end loop;
end $$;

revoke all on function public.marketing_campaign_investment_impl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.marketing_loss_reasons_impl(uuid, date, date) from public, anon, authenticated;
