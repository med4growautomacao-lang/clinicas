-- 20260713164656_fix_open_tickets_without_stage
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create or replace function public.fn_auto_open_ticket()
returns trigger
language plpgsql
security definer
as $$
DECLARE
  v_ticket_id UUID;
  v_clinic_id UUID;
  v_stage_id  UUID;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.direction = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_ticket_id
  FROM tickets
  WHERE lead_id = NEW.lead_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    NEW.ticket_id := v_ticket_id;
  ELSE
    SELECT clinic_id, stage_id INTO v_clinic_id, v_stage_id
    FROM leads WHERE id = NEW.lead_id;

    IF v_stage_id IS NULL THEN
      SELECT id INTO v_stage_id
      FROM funnel_stages
      WHERE clinic_id = v_clinic_id
      ORDER BY position
      LIMIT 1;
    END IF;

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_clinic_id, NEW.lead_id, v_stage_id, 'open', NOW())
    RETURNING id INTO v_ticket_id;

    NEW.ticket_id := v_ticket_id;
  END IF;

  RETURN NEW;
END;
$$;

create table if not exists public._backfill_tickets_sem_etapa_20260713 (
  ticket_id      uuid primary key,
  lead_id        uuid,
  clinic_id      uuid,
  old_stage_id   uuid,
  old_lead_stage uuid,
  new_stage_id   uuid,
  last_msg_at    timestamptz,
  backed_up_at   timestamptz default now()
);

with alvos as (
  select t.id as ticket_id, t.lead_id, t.clinic_id, t.stage_id as old_stage_id,
         l.stage_id as old_lead_stage,
         (select f.id from public.funnel_stages f
           where f.clinic_id = t.clinic_id order by f.position limit 1) as new_stage_id,
         lm.last_msg
  from public.tickets t
  join public.leads l on l.id = t.lead_id
  left join lateral (
    select max(cm.created_at) as last_msg from public.chat_messages cm where cm.lead_id = l.id
  ) lm on true
  where t.status = 'open'
    and t.stage_id is null
    and lm.last_msg > now() - interval '30 days'
)
insert into public._backfill_tickets_sem_etapa_20260713
  (ticket_id, lead_id, clinic_id, old_stage_id, old_lead_stage, new_stage_id, last_msg_at)
select ticket_id, lead_id, clinic_id, old_stage_id, old_lead_stage, new_stage_id, last_msg
from alvos
where new_stage_id is not null
on conflict (ticket_id) do nothing;

update public.tickets t
set stage_id = b.new_stage_id
from public._backfill_tickets_sem_etapa_20260713 b
where t.id = b.ticket_id and t.stage_id is null;

update public.leads l
set stage_id = b.new_stage_id
from public._backfill_tickets_sem_etapa_20260713 b
where l.id = b.lead_id and l.stage_id is null;
