-- Event-log de estouros de SLA: fonte única para os painéis (substitui o uso do contador
-- acumulado leads.sla_breach_count nos dashboards). Cada linha = um ciclo de resposta que
-- passou da meta (minutos úteis), gravado no momento do estouro pelo trigger fn_track_sla_breach.
CREATE TABLE public.sla_breaches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  ticket_id uuid,
  inbound_at timestamp without time zone NOT NULL,   -- última msg do lead (início da espera)
  breached_at timestamp without time zone NOT NULL,  -- resposta que fechou o ciclo (eixo do período)
  business_minutes int NOT NULL,                     -- minutos úteis de espera
  overshoot_min int NOT NULL,                         -- business_minutes - sla_minutes
  wait_raw_min numeric NOT NULL,                      -- minutos corridos (p/ teto da IA)
  sla_minutes int NOT NULL,                           -- meta vigente no momento
  sender text,                                        -- 'ai' | 'human' (quem respondeu)
  created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'::text)
);

CREATE INDEX idx_sla_breaches_clinic_breached ON public.sla_breaches (clinic_id, breached_at);
CREATE INDEX idx_sla_breaches_lead ON public.sla_breaches (lead_id);

ALTER TABLE public.sla_breaches ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_breaches_all ON public.sla_breaches FOR ALL
USING (
  ((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE clinic_users.id = auth.uid()))
    AND is_clinic_active(clinic_id))
  OR (clinic_id IN (SELECT c.id FROM clinics c JOIN org_users ou ON ou.organization_id = c.organization_id WHERE ou.user_id = auth.uid()))
  OR is_admin()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_breaches TO authenticated;
