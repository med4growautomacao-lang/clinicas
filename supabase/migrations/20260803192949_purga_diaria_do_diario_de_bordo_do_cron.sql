-- O diario de bordo do agendador (cron.job_run_details) nunca era limpo. Em 03/08/2026 ele tinha
-- 523 mil linhas desde 06/04 e ocupava 148 MB, num banco de 762 MB rodando numa maquina de 1 GB
-- de RAM. Junto com 106 MB de espaco vazio da tabela de respostas HTTP, era UM TERCO do banco
-- gasto com rastro de operacao, disputando a mesma memoria das conversas dos pacientes.
--
-- ⚠️ O custo nao era so espaco, era CPU a cada 5 minutos. O run_system_monitors procura cron que
-- falhou com `where status='failed' and start_time > <marco>`, e a tabela **nao tem indice por
-- start_time** (so a PK em runid). Medido: Parallel Seq Scan em 523 mil linhas, 346 ms, usando os
-- 2 workers paralelos de uma maquina de 2 nucleos, 288 vezes por dia. Criar o indice resolveria
-- melhor, mas a tabela e do supabase_admin e `create index` responde "must be owner of table".
-- Sobra manter a tabela pequena, que e o que esta rotina faz.
--
-- Limpeza inicial (feita a mao junto com esta migration):
--   cron.job_run_details  148 MB -> 23 MB   (416.662 linhas apagadas, 7 dias mantidos)
--   net._http_response    106 MB -> 2 MB    (36 linhas ocupavam 106 MB de arquivo vazio)
--   banco                 762 MB -> 533 MB
--
-- EFEITO MEDIDO, sem tocar em mais nada:
--   consulta do monitor por cron que falhou ....... 346 ms -> 21 ms
--   run_system_monitors inteiro (roda 288x/dia) ... 1.391 ms -> 321 ms
--   refresh_lead_attribution (roda 144x/dia) ......  743 ms -> 58 ms
-- A ultima e a mais reveladora: a funcao NAO foi alterada hoje. Ela acelerou 13x so porque as
-- paginas de lixo pararam de expulsar o dado real da memoria. Numa maquina de 1 GB, tabela morta
-- grande nao e espaco parado, e cache roubado de quem precisa.
--
-- ⚠️ 7 DIAS E A JANELA MINIMA UTIL, nao um numero redondo. Foi lendo este diario que se descobriu
-- (30/07) que quinze rotinas disparavam no mesmo segundo e derrubavam o painel do cliente, e
-- (03/08) que a rotina de atribuicao levava 8,6 s. Diagnostico de contencao se faz olhando o
-- historico de execucao; encurtar para 1 ou 2 dias economiza pouco e cega a investigacao.
create or replace function public.purge_cron_run_details(p_dias integer default 7)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_apagadas integer := 0;
begin
  delete from cron.job_run_details
   where start_time < now() - (greatest(coalesce(p_dias, 7), 2) || ' days')::interval;
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
exception when others then
  -- Sem isto a limpeza para em silencio e a tabela volta a crescer 15 mil linhas por dia ate
  -- alguem estranhar a lentidao meses depois (CLAUDE.md §0.5).
  perform public.log_system_error(
    'cron', 'PURGE_CRON_LOG_FAIL',
    'Limpeza do diario de bordo do agendador falhou: ' || sqlerrm,
    'error', null, jsonb_build_object('sqlstate', sqlstate, 'dias', p_dias), true);
  return -1;
end $function$;

revoke all on function public.purge_cron_run_details(integer) from public, anon, authenticated;
grant execute on function public.purge_cron_run_details(integer) to service_role;

-- 04:50 UTC (01:50 em SP), fora do horario de atendimento e fora dos minutos ja ocupados pelas
-- outras limpezas diarias (03:23, 04:15, 04:20 e 04:40 UTC). Colidir de proposito com elas seria
-- repetir a pilha de rotinas no mesmo segundo que derruba o painel.
select cron.schedule('purge_cron_run_details_daily', '50 4 * * *',
                     'select public.purge_cron_run_details(7);');

-- NAO ha purga para net._http_response de proposito: o proprio pg_net ja apaga as respostas por
-- TTL (sobraram 1.565 linhas vivas). O que faltava la era compactar o arquivo, e isso foi feito
-- uma vez a mao. Se voltar a inchar, o remedio e `vacuum full net._http_response`, nao uma rotina.
