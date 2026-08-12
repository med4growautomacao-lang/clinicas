-- 20260312215952_revert_ai_hard_block_for_audit
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Modificar a função para não dar erro (RAISE EXCEPTION), permitindo a escrita para auditoria
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

    -- Se global estiver OFF, marcamos mas permitimos o insert para auditoria
    IF v_global_active = false THEN
      -- Opcional: Adicionar um log ou metadado indicando que foi bloqueado no envio
      -- RAISE NOTICE 'IA Global desativada, salvando apenas para auditoria.';
      RETURN NEW;
    END IF;

    -- 2. Verifica o Switch por Lead (leads.ai_enabled - Handoff)
    SELECT ai_enabled INTO v_ai_enabled 
    FROM public.leads 
    WHERE id = NEW.lead_id;

    IF v_ai_enabled = false THEN
      -- RAISE NOTICE 'Handoff ativo, salvando apenas para auditoria.';
      RETURN NEW;
    END IF;

  END IF;

  -- Se o humano responder, desativamos a IA do lead automaticamente
  IF NEW.sender = 'human' AND NEW.direction = 'outbound' AND NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads SET ai_enabled = false WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
