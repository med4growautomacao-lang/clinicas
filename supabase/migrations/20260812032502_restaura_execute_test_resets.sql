-- 20260812032502_restaura_execute_test_resets
--
-- REVERTE a 20260812031710_revoga_test_resets_do_app, aplicada 8 minutos antes.
--
-- Motivo: classificação errada minha. Tratei as RPCs como ferramenta interna esquecida, e elas
-- são FERRAMENTA DO CLIENTE: é assim que a clínica testa a IA pelo celular dela mais de uma vez.
-- Sem o reset, o segundo teste começa no meio da conversa (a IA lembra do contato) e o fluxo de
-- primeiro contato, que é justamente o que se quer testar, fica impossível de repetir.
--
-- Medido no banco antes de restaurar: 5 clínicas com lista de números de teste configurada
-- (Clínica Vaz, Tyago Venâncio, Clínica MedDesk Demonstrativa, Lorena Barros, MedDesk Comercial),
-- 4 delas com frase de reinício preenchida. Com o botão publicado e a RPC revogada, essas
-- clínicas receberiam erro de permissão ao clicar.
--
-- ⚠️ O RISCO CONTINUA REAL E ESTÁ PENDENTE. Resolver SEM tirar a capacidade do cliente:
--   1. o telefone é casado exato, sem normalizar (§2 do CLAUDE.md) e sem exigir que esteja em
--      ai_config.test_numbers da clínica: digitar o número de um paciente real e clicar apaga o
--      histórico dele, e a RLS não impede porque é a própria clínica dele;
--   2. EXECUTE para qualquer usuário logado, incluindo quem só deveria atender;
--   3. nenhum registro de quem executou.
-- Correção desenhada: escopo por clinic_id do chamador + exigir que o telefone esteja na lista
-- de teste da clínica + restringir papel, mantendo o botão exatamente onde está.

grant execute on function public.test_reset_full(text) to authenticated;
grant execute on function public.test_reset_for_rebook(text) to authenticated;

comment on function public.test_reset_full(text) is
  'Ferramenta do CLIENTE: reinicia um contato de teste para a clínica poder testar a IA do próprio celular de novo. PENDENTE endurecer: exigir que o telefone esteja em ai_config.test_numbers da clínica do chamador, escopo por clinic_id e restrição de papel. Ver migration 20260812031710 (revogada) e 20260812032502 (restaura).';

comment on function public.test_reset_for_rebook(text) is
  'Ferramenta do CLIENTE, mesma observação de test_reset_full: reinicia o contato de teste mantendo paciente e histórico antigo.';
