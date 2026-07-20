-- Rollback de 20260719000059: readiciona os prefixos no content das funções do banco.
-- (Os edges voltam pelo git/redeploy.)
do $$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
    where proname='process_confirmation_reminders' and pronamespace='public'::regnamespace;
  if position('''CONFIRMAÇÃO: ''' in src) = 0 then
    execute replace(src, 'jsonb_build_object(''type'',''system'',''content'', v_msg,',
                         'jsonb_build_object(''type'',''system'',''content'', ''CONFIRMAÇÃO: '' || v_msg,');
  end if;

  select pg_get_functiondef(oid) into src from pg_proc
    where proname='process_pos_followup' and pronamespace='public'::regnamespace;
  if position('''PÓS-ATENDIMENTO: ''' in src) = 0 then
    execute replace(src, 'jsonb_build_object(''type'',''system'',''content'', ''PÓS-ATENDIMENTO: '' || v_msg,', -- no-op se já
                         'jsonb_build_object(''type'',''system'',''content'', ''PÓS-ATENDIMENTO: '' || v_msg,');
    execute replace(src, '''content'', v_msg,', '''content'', ''PÓS-ATENDIMENTO: '' || v_msg,');
  end if;

  select pg_get_functiondef(oid) into src from pg_proc
    where proname='fn_ticket_finish_message' and pronamespace='public'::regnamespace;
  if position('v_prefix || v_msg' in src) = 0 then
    execute replace(src, '''content'', v_msg,', '''content'', v_prefix || v_msg,');
  end if;
end $$;
