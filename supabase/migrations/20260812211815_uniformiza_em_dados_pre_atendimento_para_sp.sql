-- Uniformiza a chave "em" de tickets.dados_pre_atendimento no fuso de São Paulo, SEM sufixo.
--
-- ⚠️ O campo tinha TRÊS formatos ao mesmo tempo, e nenhum se distinguia do outro na leitura:
--   · "2026-08-12T14:34:09+00"      (13 linhas, gravadas por uma recuperação feita em SQL: UTC)
--   · "2026-08-12T19:41:20.474Z"    (2 linhas, gravadas pela edge antes do acerto de fuso: UTC)
--   · "2026-08-12T18:16:36.410"     (formato novo: São Paulo, igual ao resto do sistema)
--
-- Ninguém exibe essa chave ainda, e é exatamente por isso que consertar agora é barato: quando a
-- primeira tela mostrar "coletado às", ela vai aplicar a régua da casa (São Paulo) e as linhas
-- antigas apareceriam 3 horas erradas, sem ninguém desconfiar. Com um formato só, não há régua a
-- escolher.
--
-- Converte apenas o que TEM fuso declarado (os dois primeiros casos). Quem já está sem sufixo é o
-- formato novo e não pode ser convertido de novo: converter duas vezes desloca mais 3 horas, que
-- é o erro que este trabalho existe para não deixar acontecer.
--
-- ⚠️ ESTA MIGRATION FICOU INCOMPLETA. O regex abaixo exige quatro dígitos no deslocamento, e o
-- Postgres escreve só dois quando os minutos são zero ("+00"), então as 13 linhas em SQL passaram
-- direto. Corrigido na migration seguinte (20260812211858). Mantida como está por ser história.
update public.tickets
   set dados_pre_atendimento = dados_pre_atendimento || jsonb_build_object(
         'em',
         to_char(
           (dados_pre_atendimento->>'em')::timestamptz at time zone 'America/Sao_Paulo',
           'YYYY-MM-DD"T"HH24:MI:SS.MS'
         )
       )
 where dados_pre_atendimento ? 'em'
   and (dados_pre_atendimento->>'em') ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$';
