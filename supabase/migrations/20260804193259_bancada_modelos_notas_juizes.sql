-- Notas do julgamento às cegas da bancada de modelos (uma linha por caso x rótulo A-F).
-- Fica separada de ai_bench_results de propósito: o resultado é fato medido, a nota é opinião de
-- juiz, e misturar as duas faria a rodada seguinte sobrescrever o julgamento da anterior.
create table if not exists public.ai_bench_notas (
  case_id uuid not null,
  rotulo text not null,
  respondeu boolean, tools_nota int, inventou_fato boolean,
  regras_nota int, seguro_enviar boolean, nota_geral int,
  justificativa text, tools_comentario text, evidencia_invencao text,
  primary key (case_id, rotulo)
);
alter table public.ai_bench_notas enable row level security;
drop policy if exists ai_bench_notas_su on public.ai_bench_notas;
create policy ai_bench_notas_su on public.ai_bench_notas for all
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
