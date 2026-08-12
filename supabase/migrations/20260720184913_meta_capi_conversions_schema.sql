-- 20260720184913_meta_capi_conversions_schema
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- API de Conversões (CAPI) nativa para Click-to-WhatsApp.
-- Fecha o loop com o Meta: quando um lead ENTRA na etapa de conversão (funnel_stages.is_conversion,
-- hoje sempre 'ganho'), enfileira um evento para a Conversions API de Business Messaging.
-- O envio em si é da edge meta-capi-conversions (outbox + cron); aqui moram o schema e o gatilho.

-- 1. WABA + dataset por clínica (cache). O dataset de Business Messaging DERIVA da WABA
--    (GET /{waba_id}/dataset) e é o ENDPOINT real dos eventos — NÃO o meta_pixel_id (pixel de site).
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS meta_waba_id        text,
  ADD COLUMN IF NOT EXISTS meta_capi_dataset_id text;

-- 2. Nome do evento por etapa de conversão (configurável — pedido do dono). 'Purchase' é o padrão:
--    é o único que habilita otimização por valor/ROAS no Meta.
ALTER TABLE public.funnel_stages
  ADD COLUMN IF NOT EXISTS capi_event_name text NOT NULL DEFAULT 'Purchase';

-- 3. Outbox. Nome distinto de meta_cloud_events DE PROPÓSITO: aquele é MENSAGERIA oficial (Cloud API),
--    este é ATRIBUIÇÃO de anúncios. Só compartilham o prefixo "meta".
CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  ticket_id     uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  lead_id       uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  event_name    text NOT NULL DEFAULT 'Purchase',
  status        text NOT NULL DEFAULT 'pending',
  attempts      int  NOT NULL DEFAULT 0,
  last_error    text,
  meta_response jsonb,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_events_ticket
  ON public.meta_capi_events (ticket_id);
CREATE INDEX IF NOT EXISTS ix_meta_capi_events_pending
  ON public.meta_capi_events (status, created_at) WHERE status = 'pending';

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_capi_events_super_read ON public.meta_capi_events;
CREATE POLICY meta_capi_events_super_read ON public.meta_capi_events
  FOR SELECT USING (public.is_super_admin());

-- 4. Gatilho: entrada em etapa de conversão -> enfileira.
CREATE OR REPLACE FUNCTION public.fn_enqueue_meta_capi_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_conversion boolean;
  v_event_name    text;
BEGIN
  IF NEW.ticket_id IS NULL OR NEW.new_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.is_conversion, COALESCE(s.capi_event_name, 'Purchase')
    INTO v_is_conversion, v_event_name
    FROM public.funnel_stages s
   WHERE s.id = NEW.new_stage_id;

  IF v_is_conversion IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.meta_capi_events (clinic_id, ticket_id, lead_id, event_name)
    VALUES (NEW.clinic_id, NEW.ticket_id, NEW.lead_id, v_event_name)
    ON CONFLICT (ticket_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.log_system_error(
      'meta-capi-enqueue', 'enqueue_falhou',
      'Falha ao enfileirar evento de conversão CAPI (a mudança de etapa seguiu normal)',
      'warn', NEW.clinic_id,
      jsonb_build_object('ticket_id', NEW.ticket_id, 'lead_id', NEW.lead_id, 'erro', SQLERRM));
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_meta_capi_event ON public.lead_stage_history;
CREATE TRIGGER trg_enqueue_meta_capi_event
  AFTER INSERT ON public.lead_stage_history
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_meta_capi_event();
