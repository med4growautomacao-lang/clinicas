-- 20260312173624_fix_whatsapp_instances_constraints_and_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Garantir que api_token e api_id tenham valores padrão ou aceitem nulo
ALTER TABLE public.whatsapp_instances ALTER COLUMN api_token SET DEFAULT '';
ALTER TABLE public.whatsapp_instances ALTER COLUMN api_token SET NOT NULL; -- Mantém not null mas com default

ALTER TABLE public.whatsapp_instances ALTER COLUMN api_id SET DEFAULT '';

-- Função para inicializar configurações da clínica
CREATE OR REPLACE FUNCTION public.handle_new_clinic()
RETURNS TRIGGER AS $$
BEGIN
    -- Criar configuração de IA padrão
    INSERT INTO public.ai_config (clinic_id)
    VALUES (NEW.id)
    ON CONFLICT (clinic_id) DO NOTHING;

    -- Criar instância de WhatsApp padrão
    INSERT INTO public.whatsapp_instances (clinic_id, api_token, api_id)
    VALUES (NEW.id, '', '')
    ON CONFLICT (clinic_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger
DROP TRIGGER IF EXISTS on_clinic_created ON public.clinics;
CREATE TRIGGER on_clinic_created
AFTER INSERT ON public.clinics
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_clinic();

-- Backfill para clínicas existentes
INSERT INTO public.whatsapp_instances (clinic_id, api_token, api_id)
SELECT id, '', '' FROM public.clinics
WHERE id NOT IN (SELECT clinic_id FROM public.whatsapp_instances)
ON CONFLICT (clinic_id) DO NOTHING;

INSERT INTO public.ai_config (clinic_id)
SELECT id FROM public.clinics
WHERE id NOT IN (SELECT clinic_id FROM public.ai_config)
ON CONFLICT (clinic_id) DO NOTHING;
