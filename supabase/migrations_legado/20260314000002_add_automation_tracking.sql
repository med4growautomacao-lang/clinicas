-- ============================================
-- Rastreamento de automações (follow-up, handoff, confirmações)
-- ============================================

-- Tabela de log de cada disparo de automação
CREATE TABLE IF NOT EXISTS public.automation_logs (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id    uuid        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id      uuid        REFERENCES public.leads(id) ON DELETE SET NULL,
  type         text        NOT NULL CHECK (type IN ('followup', 'handoff', 'confirm')),
  rule_id      text,                          -- id do gatilho (handoff_rules[].id)
  triggered_at timestamptz NOT NULL DEFAULT now(),
  status       text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  message_sent text,                          -- mensagem exata enviada
  metadata     jsonb       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_clinic_id   ON public.automation_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_lead_id     ON public.automation_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_type        ON public.automation_logs(type);
CREATE INDEX IF NOT EXISTS idx_automation_logs_triggered_at ON public.automation_logs(triggered_at DESC);

COMMENT ON TABLE  public.automation_logs              IS 'Histórico de disparos de follow-up, handoff e confirmações por lead';
COMMENT ON COLUMN public.automation_logs.type         IS 'Tipo de automação: followup | handoff | confirm';
COMMENT ON COLUMN public.automation_logs.rule_id      IS 'ID do gatilho de handoff (handoff_rules[].id) quando type=handoff';
COMMENT ON COLUMN public.automation_logs.status       IS 'sent=enviado, failed=erro, skipped=já foi enviado/não aplicável';
COMMENT ON COLUMN public.automation_logs.message_sent IS 'Texto exato da mensagem enviada ao lead';

-- ============================================
-- Estado de automação por lead
-- ============================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS followup_sent_at     timestamptz,   -- última vez que recebeu follow-up
  ADD COLUMN IF NOT EXISTS followup_count       int  NOT NULL DEFAULT 0,  -- total de follow-ups enviados
  ADD COLUMN IF NOT EXISTS handoff_triggered_at timestamptz,   -- quando entrou em handoff humano
  ADD COLUMN IF NOT EXISTS confirm_sent_at      timestamptz;   -- quando recebeu confirmação de consulta

COMMENT ON COLUMN public.leads.followup_sent_at     IS 'Timestamp do último follow-up enviado';
COMMENT ON COLUMN public.leads.followup_count       IS 'Contador de follow-ups enviados ao lead';
COMMENT ON COLUMN public.leads.handoff_triggered_at IS 'Timestamp em que o handoff foi acionado (IA pausada)';
COMMENT ON COLUMN public.leads.confirm_sent_at      IS 'Timestamp em que a confirmação de consulta foi enviada';

-- ============================================
-- RLS
-- ============================================
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY automation_logs_all ON public.automation_logs
  FOR ALL USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));
