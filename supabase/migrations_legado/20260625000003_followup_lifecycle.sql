-- Ajustes de ciclo de vida do reengajamento para o modelo de passos (followup_steps).

-- (1) "Esgotou as tentativas" passa a usar o nº de PASSOS habilitados da clínica
--     (em vez de ai_config.followup_max_attempts, que vira deprecado). Ao atingir o último
--     passo, move o ticket aberto para a etapa "Perdido" (mesmo comportamento de antes).
create or replace function public.fn_check_followup_exhausted()
 returns trigger
 language plpgsql
as $function$
declare
  v_steps int;
  v_perdido_id uuid;
begin
  if NEW.followup_count = OLD.followup_count then return NEW; end if;

  select count(*) into v_steps
  from public.followup_steps
  where clinic_id = NEW.clinic_id and enabled = true;

  if v_steps is null or v_steps = 0 or NEW.followup_count < v_steps then
    return NEW;
  end if;

  select id into v_perdido_id
  from public.funnel_stages
  where clinic_id = NEW.clinic_id and name = 'Perdido'
  limit 1;

  if v_perdido_id is not null then
    update public.tickets
      set stage_id = v_perdido_id
      where lead_id = NEW.id
        and status = 'open'
        and stage_id is distinct from v_perdido_id;
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  end if;

  return NEW;
end;
$function$;

-- (2) Desliga o re-enable automático do followup ao criar agendamento. Religar reengajamento
--     em quem AGENDOU é contraproducente (foi parte do bug do Helton). As exclusões duráveis do
--     selector já blindam; aqui é limpeza — a flag para de "mentir".
drop trigger if exists trg_enable_followup_on_appointment on public.appointments;
