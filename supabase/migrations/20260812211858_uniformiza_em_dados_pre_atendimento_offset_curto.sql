-- Completa a uniformização anterior: ela só pegou as linhas terminadas em "Z".
--
-- ⚠️ O Postgres escreve o deslocamento de fuso com DUAS casas quando os minutos são zero
-- ("2026-08-12T14:34:09+00"), e o regex da migration anterior exigia quatro ("+00:00" ou "+0000").
-- Resultado: as 13 linhas gravadas em SQL não foram convertidas, e a consulta de conferência usava
-- o MESMO regex errado, então respondia "nenhuma linha com fuso" — a checagem confirmava o próprio
-- erro. Conferido depois olhando os valores crus, que é o que provou a falha.
--
-- Regex agora aceita as duas formas. O formato novo (São Paulo, sem sufixo) continua de fora: ele
-- termina em dígito, sem Z nem sinal, e converter de novo deslocaria outras 3 horas.
update public.tickets
   set dados_pre_atendimento = dados_pre_atendimento || jsonb_build_object(
         'em',
         to_char(
           (dados_pre_atendimento->>'em')::timestamptz at time zone 'America/Sao_Paulo',
           'YYYY-MM-DD"T"HH24:MI:SS.MS'
         )
       )
 where dados_pre_atendimento ? 'em'
   and (dados_pre_atendimento->>'em') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$';
