-- Dados que o SDR coletou antes de passar o contato ao vendedor.
--
-- Por que uma coluna e não a ficha do contato (leads.ai_long_memory): a ficha é TEXTO escrito por
-- um modelo, boa para o humano ler e péssima para a tela usar. Quem abre o orçamento precisa de
-- campo separado (malha, altura, comprimento), não de um parágrafo para reler e digitar.
--
-- Por que no TICKET e não no lead: os dados são do ATENDIMENTO. O mesmo cliente pode voltar meses
-- depois querendo outra tela, e a medida do pedido anterior não pode vazar para o novo orçamento.
--
-- Formato (o front só renderiza, não interpreta):
--   { "resumo": "linha pronta que foi para a equipe",
--     "itens":  [ {"campo":"Malha","valor":"3\""}, {"campo":"Altura","valor":"1,80 m"} ],
--     "em":     "timestamp ISO" }
--
-- `itens` é lista de par campo/valor de propósito, e NÃO um objeto com chaves fixas: a tool é
-- compartilhada por todos os tenants de SDR, e "malha" e "fio" só existem para quem vende tela.
-- Cada empresa diz no prompt dela quais campos mandar, e a tela mostra o que vier.
alter table public.tickets
  add column if not exists dados_pre_atendimento jsonb;

comment on column public.tickets.dados_pre_atendimento is
  'Dados coletados pelo SDR (TRANSFERIR_PARA_ESPECIALISTA): {resumo, itens:[{campo,valor}], em}. Preenchido pela ai-scheduler; lido pelo modal de orçamento.';