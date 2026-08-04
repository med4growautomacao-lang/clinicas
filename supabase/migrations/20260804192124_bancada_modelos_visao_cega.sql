-- Julgamento às cegas: cada resultado ganha um rótulo A-F que MUDA de caso para caso.
--
-- Sem isto o juiz veria "gemini-3.1-pro" (o modelo que está em produção) ao lado dos candidatos e
-- traria expectativa para dentro da nota. A rotação por caso impede também o truque oposto: decorar
-- que "A é sempre o de produção" depois de ler dois casos.
create or replace view public.v_ai_bench_cego as
with mrank as (
  select model, (dense_rank() over (order by model)) - 1 as mr
  from (select distinct model from public.ai_bench_results) m
), crank as (
  select id as case_id, (row_number() over (order by created_at)) - 1 as cr
  from public.ai_bench_cases
)
select r.id as result_id, r.case_id,
       chr((65 + ((mrank.mr + crank.cr) % 6))::int) as rotulo,
       r.status, r.reply_text, r.tool_calls, r.iters, r.tokens_in, r.tokens_out,
       r.latency_ms, r.guard_hit
  from public.ai_bench_results r
  join mrank on mrank.model = r.model
  join crank on crank.case_id = r.case_id;

revoke all on public.v_ai_bench_cego from public, anon, authenticated;
grant select on public.v_ai_bench_cego to service_role;
