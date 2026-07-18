-- Mensagens de resposta aos botões de confirmação (Remarcar / Cancelar).
-- O botão "Confirmar" já usa confirm_post_message ("Após Confirmação"); aqui completamos
-- os outros dois botões. Usados pelo handler nativo de resposta de confirmação.
alter table public.ai_config
  add column if not exists confirm_reply_remarcado text,
  add column if not exists confirm_reply_cancelado text;

comment on column public.ai_config.confirm_reply_remarcado is
  'Resposta enviada quando o paciente toca "Remarcar" no lembrete de confirmação. Vars: {paciente} {data} {hora}.';
comment on column public.ai_config.confirm_reply_cancelado is
  'Resposta enviada quando o paciente toca "Cancelar" no lembrete de confirmação. Vars: {paciente} {data} {hora}.';
