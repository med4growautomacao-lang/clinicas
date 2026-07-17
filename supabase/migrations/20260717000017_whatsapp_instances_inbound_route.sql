-- =============================================================================
-- C4 — roteamento de ingestão por clínica (blindagem do canário na reconexão)
--
-- O whatsapp-orchestrator (ensureUazapiWebhooks) recriava o webhook do n8n na
-- reconexão → DUPLA ENTREGA nas clínicas já no hub. Esta flag diz o destino do
-- evento 'messages': 'n8n' (default) | 'hub' (usa wa-inbound e remove n8n stale).
-- O orchestrator lê inbound_route no call-site e o passa a ensureUazapiWebhooks;
-- para route='hub' ele também DELETA o webhook n8n stale (self-healing).
-- =============================================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_route text NOT NULL DEFAULT 'n8n';

-- Canário 17/07 (São Lucas, MedDesk Comercial, Clínica Vaz) → hub
UPDATE public.whatsapp_instances
SET inbound_route = 'hub'
WHERE clinic_id IN (
  '97c7eb50-11a1-425f-b227-30a5de625d2b',
  '389e2eef-2bf5-4f2c-a260-56fdbf443291',
  '2c9c4e85-df66-41f6-b345-8b7ec94f0605'
);
