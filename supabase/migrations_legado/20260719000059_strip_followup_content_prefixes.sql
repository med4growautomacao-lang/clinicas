-- Remove os prefixos rotuladores do content das mensagens de automação
-- (FOLLOWUP:/REENGAJAMENTO: nos edges; CONFIRMAÇÃO:/PÓS-ATENDIMENTO:/ENCERRAMENTO …: no banco).
-- Motivo: o ícone Cog no chat já distingue sender='system', e a memória da IA já recebe type='system'
-- — o prefixo virou ruído no chat. Nada no código lê esses prefixos (verificado por grep).
-- Replace cirúrgico no corpo das funções (não reescreve os 200+ linhas; não altera nenhuma lógica).
-- Os edges forms-welcome-followup / reengagement-followup são alterados no código-fonte (redeploy).
do $$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
    where proname='process_confirmation_reminders' and pronamespace='public'::regnamespace;
  if position('''CONFIRMAÇÃO: '' || v_msg' in src) > 0 then
    execute replace(src, '''CONFIRMAÇÃO: '' || v_msg', 'v_msg');
  end if;

  select pg_get_functiondef(oid) into src from pg_proc
    where proname='process_pos_followup' and pronamespace='public'::regnamespace;
  if position('''PÓS-ATENDIMENTO: '' || v_msg' in src) > 0 then
    execute replace(src, '''PÓS-ATENDIMENTO: '' || v_msg', 'v_msg');
  end if;

  select pg_get_functiondef(oid) into src from pg_proc
    where proname='fn_ticket_finish_message' and pronamespace='public'::regnamespace;
  if position('v_prefix || v_msg' in src) > 0 then
    execute replace(src, 'v_prefix || v_msg', 'v_msg');
  end if;
end $$;
