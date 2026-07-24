-- LEMBRETE DE CONSULTA — 5º follow-up nativo. Complementa a Confirmação (NÃO a substitui):
-- a Confirmação manda um MENU com botões ~24h antes ("confirma?"); o Lembrete manda UMA mensagem
-- de TEXTO ~2h antes ("é hoje às X"). Clínica pode ligar um, outro, ou os dois.
--
-- Esta migration é SÓ o schema. O motor, os candidatos, o preview e a UI vêm na migration seguinte.
-- Todas as chaves nascem DESLIGADAS (appt_reminder_enabled=false): aplicar isto NÃO muda produção.
--
-- ⚠️ NOMES QUE ENGANAM: `appointments.reminder_sent_at` (sem o prefixo) JÁ EXISTE e é da CONFIRMAÇÃO
-- (o menu de botões, process_confirmation_reminders). O Lembrete usa colunas PRÓPRIAS com prefixo
-- `appt_reminder_` para os dois follow-ups nunca se pisarem. Confundi-los reenviaria ou suprimiria
-- a mensagem errada.

-- ---------------------------------------------------------------------------------------------
-- Config por clínica. Espelha a estrutura da Confirmação (enabled/message/lead_time/window),
-- mais dois controles próprios: tolerância de atraso e "só quem já confirmou".
alter table public.ai_config
  add column if not exists appt_reminder_enabled        boolean not null default false,
  add column if not exists appt_reminder_message         text    not null default 'Olá {paciente}! Passando para lembrar da sua consulta hoje às {hora}. Te esperamos! 😊',
  add column if not exists appt_reminder_lead_time        integer not null default 120,   -- minutos ANTES da consulta
  add column if not exists appt_reminder_window_start     integer not null default 8,     -- hora (0-23, SP) de início da janela de envio
  add column if not exists appt_reminder_window_end       integer not null default 20,    -- hora (1-24, SP) de fim da janela
  add column if not exists appt_reminder_grace_minutes    integer not null default 60,    -- atraso máximo tolerado antes de VENCER (não manda "é às 14h" às 17h)
  add column if not exists appt_reminder_only_confirmed   boolean not null default false; -- true = só para status='confirmado' (quem respondeu a Confirmação)

comment on column public.ai_config.appt_reminder_lead_time is
  'Minutos ANTES da consulta em que o lembrete dispara. Distinto de confirm_lead_time (Confirmação), que é tipicamente 1440 (24h).';
comment on column public.ai_config.appt_reminder_grace_minutes is
  'Janela de tolerância após o eligible_at. Passou disto sem enviar (WhatsApp fora, fora da janela de horário), o lembrete VENCE em vez de sair atrasado — um lembrete de "daqui 2h" não pode chegar depois da consulta.';

-- ---------------------------------------------------------------------------------------------
-- Dedup do envio. `timestamp` sem tz (já é SP), igual ao reminder_sent_at da Confirmação: o motor
-- grava `now() at time zone 'America/Sao_Paulo'`. NÃO converter na exibição (dupla conversão = -3h).
alter table public.appointments
  add column if not exists appt_reminder_sent_at    timestamp without time zone,
  add column if not exists appt_reminder_expired_at timestamp without time zone;

comment on column public.appointments.appt_reminder_sent_at is
  'Lembrete de consulta (appt_reminder) já enfileirado/enviado. NÃO confundir com reminder_sent_at, que é da Confirmação (menu de botões).';

-- ---------------------------------------------------------------------------------------------
-- RE-ARME NA REMARCAÇÃO. Mudou data/hora, o lembrete tem que valer para o horário NOVO. Sem isto,
-- remarcar significaria lembrete nenhum na data nova (a Confirmação tem esse mesmo furo hoje, e
-- fica intocada aqui de propósito — é comportamento em produção, mexer nela é ordem separada).
create or replace function public.fn_appt_rearm_reminder()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if (NEW.date, NEW."time") is distinct from (OLD.date, OLD."time") then
    NEW.appt_reminder_sent_at    := null;
    NEW.appt_reminder_expired_at := null;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_appt_rearm_reminder on public.appointments;
create trigger trg_appt_rearm_reminder
  before update of date, "time" on public.appointments
  for each row execute function public.fn_appt_rearm_reminder();
