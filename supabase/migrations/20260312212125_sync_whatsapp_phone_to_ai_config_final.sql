-- 20260312212125_sync_whatsapp_phone_to_ai_config_final
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adicionar coluna phone na ai_config se não existir
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'phone') THEN
    ALTER TABLE public.ai_config ADD COLUMN phone text;
  END IF;
END $$;

-- Criar ou substituir a função de sincronização
CREATE OR REPLACE FUNCTION public.sync_whatsapp_phone_to_ai_config()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.ai_config
  SET phone = NEW.phone_number
  WHERE clinic_id = NEW.clinic_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar o trigger
DROP TRIGGER IF EXISTS tr_sync_whatsapp_phone ON public.whatsapp_instances;
CREATE TRIGGER tr_sync_whatsapp_phone
AFTER INSERT OR UPDATE OF phone_number ON public.whatsapp_instances
FOR EACH ROW
EXECUTE FUNCTION public.sync_whatsapp_phone_to_ai_config();

-- Sincronizar dados existentes
UPDATE public.ai_config ac
SET phone = wi.phone_number
FROM public.whatsapp_instances wi
WHERE ac.clinic_id = wi.clinic_id;
