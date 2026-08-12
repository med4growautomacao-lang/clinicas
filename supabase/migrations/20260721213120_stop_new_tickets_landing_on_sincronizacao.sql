-- 20260721213120_stop_new_tickets_landing_on_sincronizacao
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 'Sincronização' (posição 0 do funil, todo clinic) virou lixeira de facto: qualquer ticket novo
-- sem etapa (lead.stage_id NULL) caía nela via fallback "1ª etapa por position". Não é sincronização
-- de nada — é só o nome histórico da etapa 0. 943 leads/tickets estagnados (>7 dias) ali foram
-- excluídos (leads inteiros, cascade) em 21/07; os que restaram (<7 dias) foram movidos para
-- 'Contato via WhatsApp'. Esta migration corta a fonte: nenhum ticket novo nasce mais em
-- 'sincronizacao'.
--
-- Decisão do usuário: 'Contato via WhatsApp' é a etapa PRIORITÁRIA para ticket novo (não mais um
-- fallback condicional a lead.stage_id ser NULL) — exceto quando o lead veio de formulário, aí é
-- 'Contato via Forms'. A etapa 'sincronizacao' continua existindo no funil (não pode ser excluída,
-- é is_system) mas some do fallback e fica oculta no Kanban (mudança em LeadKanban.tsx).

begin;

create or replace function public.fn_auto_open_ticket()
returns trigger
language plpgsql
security definer
as $$
DECLARE
  v_ticket_id UUID;
  v_clinic_id UUID;
  v_capture_channel TEXT;
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
    SELECT clinic_id, capture_channel INTO v_clinic_id, v_capture_channel
    FROM leads WHERE id = NEW.lead_id;

    IF v_capture_channel = 'forms' THEN
      SELECT id INTO v_stage_id FROM funnel_stages
      WHERE clinic_id = v_clinic_id AND slug = 'forms'
      ORDER BY position LIMIT 1;
    END IF;

    IF v_stage_id IS NULL THEN
      SELECT id INTO v_stage_id FROM funnel_stages
      WHERE clinic_id = v_clinic_id AND slug = 'whatsapp'
      ORDER BY position LIMIT 1;
    END IF;

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

create or replace function public.fn_auto_open_ticket_forms()
returns trigger
language plpgsql
security definer
as $$
DECLARE
  v_stage_id UUID;
BEGIN
  IF NEW.capture_channel IS DISTINCT FROM 'forms' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM tickets WHERE lead_id = NEW.id AND status = 'open') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_stage_id FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'forms'
  ORDER BY position LIMIT 1;

  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id AND slug = 'whatsapp'
    ORDER BY position LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id
    ORDER BY position LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, NEW.id, v_stage_id, 'open', NOW());

  RETURN NEW;
END;
$$;

commit;
