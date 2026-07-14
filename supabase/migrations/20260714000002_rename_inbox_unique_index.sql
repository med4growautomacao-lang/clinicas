-- O índice único foi criado antes do rename da tabela e ficou com o nome antigo. Ele aparece na
-- mensagem do erro 409 que o n8n recebe ao perder a corrida — com o nome errado, confunde o debug.

alter index if exists public.lead_tracking_inbox_external_id_uniq
  rename to attribution_inbox_external_id_uniq;
