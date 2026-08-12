-- 20260514163604_extend_auto_open_ticket_to_outbound
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_auto_open_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_ticket_id UUID;
  v_clinic_id UUID;
  v_stage_id  UUID;
BEGIN
  -- Pula apenas mensagens 'system' ou sem lead_id
  IF NEW.lead_id IS NULL OR NEW.direction = 'system' THEN
    RETURN NEW;
  END IF;

  -- Busca ticket aberto mais recente do lead
  SELECT id INTO v_ticket_id
  FROM tickets
  WHERE lead_id = NEW.lead_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    NEW.ticket_id := v_ticket_id;
  ELSE
    -- Busca clinic_id do lead
    SELECT clinic_id, stage_id INTO v_clinic_id, v_stage_id
    FROM leads WHERE id = NEW.lead_id;

    -- Fallback: se lead.stage_id é null, pega primeira stage do funil da clinic
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
$function$;
