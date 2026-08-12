-- 20260516015349_extend_move_to_whatsapp_include_sincronizacao
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Estende o trigger: move 'forms' E 'sincronizacao' → 'whatsapp' na 1ª inbound
CREATE OR REPLACE FUNCTION public.fn_move_forms_to_whatsapp_on_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_whatsapp_stage_id uuid;
BEGIN
  IF NEW.direction <> 'inbound' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_whatsapp_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'whatsapp'
  LIMIT 1;

  IF v_whatsapp_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE tickets t
  SET stage_id = v_whatsapp_stage_id
  WHERE t.lead_id = NEW.lead_id
    AND t.status = 'open'
    AND t.stage_id IN (
      SELECT id FROM funnel_stages
      WHERE clinic_id = NEW.clinic_id
        AND slug IN ('forms', 'sincronizacao')
    );

  RETURN NEW;
END;
$function$;

-- Backfill: tickets abertos em 'sincronizacao' cujo lead já mandou inbound → 'whatsapp'
UPDATE tickets t
SET stage_id = ws.id
FROM funnel_stages fs_origem
JOIN funnel_stages ws
  ON ws.clinic_id = fs_origem.clinic_id AND ws.slug = 'whatsapp'
WHERE t.stage_id = fs_origem.id
  AND fs_origem.slug = 'sincronizacao'
  AND t.status = 'open'
  AND EXISTS (
    SELECT 1 FROM chat_messages cm
    WHERE cm.lead_id = t.lead_id AND cm.direction = 'inbound'
  );
