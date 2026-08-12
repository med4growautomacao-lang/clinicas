-- 20260312214835_update_ai_security_guard_with_master_switch
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Atualizar a função para incluir o Master Switch (auto_schedule)
CREATE OR REPLACE FUNCTION public.block_ai_when_disabled()
RETURNS TRIGGER AS $$
DECLARE
  v_ai_enabled boolean;
  v_global_active boolean;
BEGIN
  -- Se as mensagens forem enviadas pela IA (sender = 'ai')
  IF NEW.sender = 'ai' AND NEW.lead_id IS NOT NULL THEN
    
    -- 1. Verifica o Master Switch Global (ai_config.auto_schedule)
    SELECT auto_schedule INTO v_global_active 
    FROM public.ai_config 
    WHERE clinic_id = NEW.clinic_id;

    IF v_global_active = false THEN
      RAISE EXCEPTION 'Atendimento Global da IA está desativado para esta clínica.';
    END IF;

    -- 2. Verifica o Switch por Lead (leads.ai_enabled - Handoff)
    SELECT ai_enabled INTO v_ai_enabled 
    FROM public.leads 
    WHERE id = NEW.lead_id;

    IF v_ai_enabled = false THEN
      RAISE EXCEPTION 'Atendimento por IA está desativado para este lead (Handoff ativo).';
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
