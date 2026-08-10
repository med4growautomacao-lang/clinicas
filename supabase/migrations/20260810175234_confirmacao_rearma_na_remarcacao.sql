-- REGRA (decisao do dono, 10/08): remarcou, a CONFIRMACAO volta a valer.
--
-- Ate aqui `appointments.reminder_sent_at` (a marca da confirmacao) era escrita por UMA unica funcao
-- do banco, a que envia, e NUNCA limpa por ninguem: nem pelo `reschedule_appointment`, nem pela
-- agenda, nem por gatilho (conferido em todas as funcoes). Consequencia: paciente confirmava terca,
-- a clinica movia para quinta e ele nao recebia mais nada. Pior, o agendamento continuava marcado
-- como `confirmado`, ou seja, a agenda mostrava como garantida uma data que o paciente nunca viu.
-- O lembrete ja rearmava desde 23/07; a confirmacao ficou para tras.
--
-- Agora as duas rearmam no MESMO gatilho: mudou data ou hora, o paciente recebe nova confirmacao
-- com a data nova e o agendamento volta para `pendente` ate ele confirmar de novo.
--
-- 📌 Qualquer mudanca de horario rearma, inclusive de 10 minutos. E o mesmo criterio que o lembrete
-- ja usa e o que o `dedup_key` (`confirm_reminder:<id>:<data> <hora>`) sempre esperou.
--
-- ⚠️ Isto NAO vira disparo em cima da hora: se a data nova cair dentro da janela de envio, a regra
-- de `schedule_set_at` (migration 20260810173131) segura o envio. As duas se completam.
--
-- ⚠️ `NEW.status` so e rebaixado quando o proprio UPDATE nao esta mexendo no status. Sem essa
-- guarda, salvar data e status juntos (remarcar ja marcando 'realizado') seria sobrescrito para
-- 'pendente', que e corrupcao de agenda.
--
-- Os 3 gatilhos AFTER UPDATE OF status sao inofensivos para 'pendente' de qualquer forma:
-- fn_auto_move_lead_on_status_change nao tem etapa alvo para 'pendente', fn_notify_appointment_event
-- so avisa em 'cancelado' e fn_sync_summary_on_appt_status atende uma clinica so e ja nao roda em
-- remarcacao comum. O rastro continua: trg_zz_log_appointment_change grava a troca em
-- appointment_changes.
--
-- Provado em transacao revertida numa consulta real da Clinica Vaz:
--   confirmada + ja enviada -> candidato 0 | apos remarcar -> status 'pendente', marca limpa,
--   candidato 1 com a data nova | UPDATE de data + status juntos -> status 'realizado' preservado.
CREATE OR REPLACE FUNCTION public.fn_appt_rearm_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if (NEW.date, NEW."time") is distinct from (OLD.date, OLD."time") then
    -- lembrete de consulta
    NEW.appt_reminder_sent_at    := null;
    NEW.appt_reminder_expired_at := null;
    -- marco de "quando o horario foi definido" (regra do envio em cima da hora)
    NEW.schedule_set_at          := now() at time zone 'America/Sao_Paulo';
    -- confirmacao: a resposta do paciente era sobre a data ANTIGA, entao nao vale mais
    NEW.reminder_sent_at         := null;
    if NEW.status is not distinct from OLD.status and OLD.status = 'confirmado' then
      NEW.status := 'pendente';
    end if;
  end if;
  return NEW;
end $function$;

COMMENT ON FUNCTION public.fn_appt_rearm_reminder() IS
  'BEFORE UPDATE OF date/time em appointments: rearma lembrete E confirmacao, carimba schedule_set_at e rebaixa confirmado para pendente. Remarcou = tudo volta a valer para a data nova.';
