-- Religamento automático da IA após handoff (config por clínica).
--
-- Toggle liga/desliga + tempo. Quando ligado, a IA volta a atender um lead que recebeu
-- handoff após X MINUTOS DE SILÊNCIO DO HUMANO (não desde o início do handoff — senão a IA
-- voltaria no meio de um atendimento humano longo).
--
-- Por isso o trigger passa a dar "keep-alive" no handoff_triggered_at a cada mensagem do
-- operador (sem re-notificar): o timestamp vira "última atividade humana", e o cron mede
-- o silêncio a partir dele.

-- 1) Config por clínica
alter table public.ai_config
  add column if not exists handoff_auto_return_enabled boolean not null default false,
  add column if not exists handoff_auto_return_minutes integer;

comment on column public.ai_config.handoff_auto_return_enabled is
  'Se true, a IA volta a atender leads em handoff após handoff_auto_return_minutes de silêncio do humano.';
comment on column public.ai_config.handoff_auto_return_minutes is
  'Minutos de silêncio do humano até religar a IA (só vale com handoff_auto_return_enabled=true).';

-- 2) Trigger: transição liga->pausa (notifica) + keep-alive do relógio (não notifica)
create or replace function public.fn_handoff_on_human_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead record;
  v_uses_ai boolean;
begin
  if NEW.lead_id is null then
    return NEW;
  end if;

  select id, name, phone, ai_enabled, handoff_triggered_at, is_not_lead
    into v_lead from leads where id = NEW.lead_id;
  if v_lead.id is null then
    return NEW;
  end if;

  -- Handoff JÁ ativo (IA pausada por handoff): só atualiza o relógio de "última atividade
  -- humana" para o auto-return medir SILÊNCIO. Sem re-notificar. (Não mexe em leads pausados
  -- por outro motivo — handoff_triggered_at IS NULL, ex.: is_not_lead.)
  if v_lead.ai_enabled is not true then
    if v_lead.handoff_triggered_at is not null then
      update leads set handoff_triggered_at = (now() at time zone 'America/Sao_Paulo')
       where id = v_lead.id;
    end if;
    return NEW;
  end if;

  -- Transição ligada->pausada: só clínicas que usam IA
  select coalesce(auto_schedule, false) into v_uses_ai from ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_uses_ai, false) then
    return NEW;
  end if;

  update leads
     set ai_enabled = false,
         handoff_triggered_at = (now() at time zone 'America/Sao_Paulo')
   where id = v_lead.id;

  perform notify_ops(
    NEW.clinic_id, 'handoff', 'Atendimento assumido por humano',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone) || ' — a IA foi pausada para este lead.',
    'warning', v_lead.id, null, null, null,
    jsonb_build_object('reason', 'manual_reply'), true, null
  );
  return NEW;
exception when others then
  perform log_system_error(
    'handoff-trigger', 'handoff_write_failed',
    'Falha ao pausar IA / notificar no handoff manual', 'error',
    NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false
  );
  return NEW;
end;
$$;

-- 3) Cron: religa a IA de quem passou do tempo de silêncio
create or replace function public.process_handoff_auto_return()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  with reenabled as (
    update leads l
       set ai_enabled = true, handoff_triggered_at = null
      from ai_config ac
     where l.clinic_id = ac.clinic_id
       and ac.handoff_auto_return_enabled = true
       and coalesce(ac.handoff_auto_return_minutes, 0) > 0
       and l.ai_enabled = false
       and l.handoff_triggered_at is not null
       and coalesce(l.is_not_lead, false) = false
       and l.handoff_triggered_at
             < (now() at time zone 'America/Sao_Paulo') - make_interval(mins => ac.handoff_auto_return_minutes)
    returning l.id
  )
  select count(*) into v_count from reenabled;
  return v_count;
exception when others then
  perform log_system_error(
    'handoff-auto-return', 'auto_return_failed',
    'Falha no religamento automático da IA pós-handoff', 'error',
    null, jsonb_build_object('detail', sqlerrm), false
  );
  return 0;
end;
$$;

-- 4) Agenda o cron (a cada 5 min)
do $$
begin
  perform cron.unschedule('handoff_auto_return_job');
exception when others then null;
end $$;
select cron.schedule('handoff_auto_return_job', '*/5 * * * *', 'select public.process_handoff_auto_return();');
