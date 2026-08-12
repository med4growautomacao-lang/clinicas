-- 20260330204408_create_lead_stage_history_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Cria a tabela de histórico de etapas
CREATE TABLE public.lead_stage_history (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    old_stage_id UUID REFERENCES public.funnel_stages(id) ON DELETE SET NULL,
    new_stage_id UUID REFERENCES public.funnel_stages(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Comentário para a tabela
COMMENT ON TABLE public.lead_stage_history IS 'Histórico de mudanças de etapa dos leads (útil para BI e performance)';

-- 2. Configura RLS (Segurança de Linha)
ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for clinic users on lead stage history"
ON public.lead_stage_history FOR ALL TO authenticated USING (
    clinic_id IN (
        SELECT clinic_id FROM public.users WHERE users.id = auth.uid()
    )
);

-- 3. Cria a função de gatilho para registrar automaticamente a mudança
CREATE OR REPLACE FUNCTION public.fn_log_lead_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    -- Se for um novo lead sendo inserido (e ele tiver etapa)
    IF (TG_OP = 'INSERT') THEN
        IF NEW.stage_id IS NOT NULL THEN
            INSERT INTO public.lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
            VALUES (NEW.clinic_id, NEW.id, NULL, NEW.stage_id, now());
        END IF;
    -- Se for uma atualização de lead, apenas registra se a etapa antiga for diferente da nova
    ELSIF (TG_OP = 'UPDATE') THEN
        IF coalesce(NEW.stage_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(OLD.stage_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
            INSERT INTO public.lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
            VALUES (NEW.clinic_id, NEW.id, OLD.stage_id, NEW.stage_id, now());
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;

-- 4. Anexa o gatilho na tabela de leads
DROP TRIGGER IF EXISTS trg_log_lead_stage_change ON public.leads;
CREATE TRIGGER trg_log_lead_stage_change
AFTER INSERT OR UPDATE OF stage_id ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.fn_log_lead_stage_change();
