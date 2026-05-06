-- Migration: create_tickets_table
-- Criado em: 2026-05-06
-- Descrição: Sistema de tickets (ciclos de atendimento) para o funil de oportunidades

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES funnel_stages(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  close_reason text CHECK (close_reason IN ('ganho', 'perdido', 'nps_enviado')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_lead_id_idx ON tickets(lead_id);
CREATE INDEX IF NOT EXISTS tickets_clinic_id_idx ON tickets(clinic_id);
CREATE INDEX IF NOT EXISTS tickets_stage_id_idx ON tickets(stage_id);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tickets' AND policyname = 'clinic members can manage tickets'
  ) THEN
    CREATE POLICY "clinic members can manage tickets"
      ON tickets FOR ALL
      USING (clinic_id IN (
        SELECT clinic_id FROM clinic_users WHERE user_id = auth.uid()
      ));
  END IF;
END$$;

-- Migrar todos os leads com stage para tickets abertos
INSERT INTO tickets (clinic_id, lead_id, stage_id, opened_at, status)
SELECT l.clinic_id, l.id, l.stage_id, l.created_at, 'open'
FROM leads l
WHERE l.stage_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.lead_id = l.id);

-- Fechar tickets de leads que já foram convertidos (têm vendas registradas)
UPDATE tickets t
SET status = 'closed', close_reason = 'ganho',
    closed_at = c.last_conversion
FROM (
  SELECT lead_id, MAX(converted_at) as last_conversion
  FROM conversions
  GROUP BY lead_id
) c
WHERE t.lead_id = c.lead_id AND t.status = 'open';

-- Fechar tickets de leads que estão na etapa 'perdido'
UPDATE tickets t
SET status = 'closed', close_reason = 'perdido', closed_at = now()
FROM leads l
JOIN funnel_stages fs ON fs.id = l.stage_id
WHERE t.lead_id = l.id
  AND fs.slug = 'perdido'
  AND t.status = 'open';
