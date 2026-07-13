-- Tickets abertos sem etapa: leads invisíveis no Kanban + versiona o fallback do auto-open.
--
-- Sintoma: o Kanban monta as colunas com `.filter(t => t.stage_id === stage.id)` (LeadKanban.tsx),
-- então um ticket ABERTO com stage_id NULL não cai em coluna nenhuma — o lead some da tela.
--
-- Causa: `fn_auto_open_ticket` (20260507000002) abria o ticket herdando `leads.stage_id`; quando o
-- lead não tinha etapa, o ticket nascia sem etapa. Um fallback (pega a 1ª etapa do funil) foi
-- aplicado DIRETO NO BANCO em ~14/05 e nunca versionado — por isso o vazamento tem janela fechada
-- (12/05 22:57 → 14/05 16:33, 389 tickets em 20 clínicas) e parou sozinho.
--
-- Esta migration faz duas coisas:
--   (1) versiona o fallback, para o bug não voltar se as migrations forem reaplicadas do zero;
--   (2) devolve ao Kanban apenas os tickets AINDA ATIVOS (conversa nos últimos 30 dias).
-- Decisão do usuário: os ~355 parados há 45+ dias ficam como estão — reabri-los inundaria o funil
-- de 20 clínicas com cards mortos de maio. Nenhum dos 389 virou paciente.

begin;

-- ---------------------------------------------------------------------------
-- (1) Versiona fn_auto_open_ticket COM o fallback de etapa (estado atual do banco)
-- ---------------------------------------------------------------------------
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

    -- Fallback: lead sem etapa -> 1ª etapa do funil da clínica.
    -- Sem isto o ticket nasce com stage_id NULL e o lead fica invisível no Kanban.
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

-- ---------------------------------------------------------------------------
-- (2) Backfill: devolve ao Kanban os tickets abertos sem etapa AINDA ATIVOS
-- ---------------------------------------------------------------------------
create table if not exists public._backfill_tickets_sem_etapa_20260713 (
  ticket_id     uuid primary key,
  lead_id       uuid,
  clinic_id     uuid,
  old_stage_id  uuid,          -- sempre NULL (é o bug), guardado para rollback simétrico
  old_lead_stage uuid,
  new_stage_id  uuid,
  last_msg_at   timestamptz,
  backed_up_at  timestamptz default now()
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
    and (
      lm.last_msg > now() - interval '30 days'                 -- os vivos
      -- + a Tyago inteira: 3 dos 4 são leads de campanha Meta PAGA que nunca chegaram a
      -- aparecer no Kanban. São poucos cards e a clínica pagou por eles.
      or t.clinic_id = 'a04a78de-358b-4dcc-9d47-8f02d9a61ef2'
    )
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

-- Mantém leads.stage_id coerente com o ticket (o Kanban usa o ticket, mas outras telas leem o lead)
update public.leads l
set stage_id = b.new_stage_id
from public._backfill_tickets_sem_etapa_20260713 b
where l.id = b.lead_id and l.stage_id is null;

commit;

-- ============================================================================
-- ROLLBACK:
--   begin;
--   update public.tickets t set stage_id = b.old_stage_id
--     from public._backfill_tickets_sem_etapa_20260713 b where t.id = b.ticket_id;
--   update public.leads l set stage_id = b.old_lead_stage
--     from public._backfill_tickets_sem_etapa_20260713 b where l.id = b.lead_id;
--   drop table public._backfill_tickets_sem_etapa_20260713;
--   commit;
-- ============================================================================
