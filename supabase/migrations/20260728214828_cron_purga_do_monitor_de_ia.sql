-- Purga do monitor de consumo. Sem isto a tabela so cresce: o agente sozinho gera varias linhas
-- POR MENSAGEM (o loop de tool-calling chama o modelo mais de uma vez por turno).
-- 90 dias cobre comparacao mes a mes, que e o que o painel oferece.
-- Horario colado no purge do Emissor (04:15) de proposito: madrugada, fora do pico.
select cron.schedule('llm_usage_purge_daily', '20 4 * * *', $$ select public.purge_llm_usage(); $$);
