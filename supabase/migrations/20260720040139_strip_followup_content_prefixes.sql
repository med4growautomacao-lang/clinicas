-- 20260720040139_strip_followup_content_prefixes
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove os prefixos rotuladores do content das mensagens de automação (o ícone Cog já distingue
-- system no chat, e a memória da IA já recebe como type='system'). Replace cirúrgico no corpo.
do $$
declare src text;
begin
  -- CONFIRMAÇÃO
  select pg_get_functiondef(oid) into src from pg_proc
    where proname='process_confirmation_reminders' and pronamespace='public'::regnamespace;
  if position('''CONFIRMAÇÃO: '' || v_msg' in src) > 0 then
    execute replace(src, '''CONFIRMAÇÃO: '' || v_msg', 'v_msg');
  end if;

  -- PÓS-ATENDIMENTO
  select pg_get_functiondef(oid) into src from pg_proc
    where proname='process_pos_followup' and pronamespace='public'::regnamespace;
  if position('''PÓS-ATENDIMENTO: '' || v_msg' in src) > 0 then
    execute replace(src, '''PÓS-ATENDIMENTO: '' || v_msg', 'v_msg');
  end if;

  -- ENCERRAMENTO (v_prefix continua atribuído, mas não entra mais no content)
  select pg_get_functiondef(oid) into src from pg_proc
    where proname='fn_ticket_finish_message' and pronamespace='public'::regnamespace;
  if position('v_prefix || v_msg' in src) > 0 then
    execute replace(src, 'v_prefix || v_msg', 'v_msg');
  end if;
end $$;
