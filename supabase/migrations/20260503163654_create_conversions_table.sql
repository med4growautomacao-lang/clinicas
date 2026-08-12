-- 20260503163654_create_conversions_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE public.conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  value numeric NOT NULL DEFAULT 0,
  description text,
  payment_method text, -- pix, cartao, dinheiro, boleto, transferencia
  converted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_conversions_clinic_id ON public.conversions(clinic_id);
CREATE INDEX idx_conversions_lead_id ON public.conversions(lead_id);

ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_conversions_access" ON public.conversions
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid()
      UNION
      SELECT id FROM public.clinics WHERE id IN (
        SELECT c.id FROM public.clinics c
        JOIN public.org_users ou ON ou.organization_id = c.organization_id
        WHERE ou.user_id = auth.uid()
      )
    )
  );
