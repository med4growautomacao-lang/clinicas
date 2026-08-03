-- A janela de conversa do agente passa a carregar a HORA de cada mensagem.
--
-- Motivo: as mensagens de follow-up (boas-vindas, reengajamento, lembrete de consulta, lembrete de
-- confirmacao, encerramento) sao gravadas com sender='system' e entram na janela do agente como
-- "voz da clinica", sem distincao e sem hora. O agente entao nao sabe (a) que aquilo foi automatico
-- e nao ele que falou, nem (b) HA QUANTO TEMPO a clinica procurou a pessoa, que e o que separa um
-- "acabamos de te escrever" de um "te escrevemos ha tres dias".
--
-- ⚠️ `chat_messages.created_at` e `timestamp SEM timezone` e JA esta em America/Sao_Paulo
-- (CLAUDE.md §3). Quem consumir NAO deve converter de novo: passar por `new Date()` no TypeScript
-- trata como UTC e desloca 3h, que e o erro classico desta base.
--
-- `create or replace view` acrescentando coluna no FIM e permitido e preserva o trigger
-- `trg_vw_n8n_chat_memory_insert` (fn_memory_insert_shield), que continua sendo o escritor.
create or replace view public.vw_n8n_chat_memory as
  select seq as id,
         session_id,
         message,
         direction,
         sender,
         created_at
    from public.chat_messages
   where jsonb_typeof(message) = 'object'::text;
