-- 20260717185408_whatsapp_instances_inbound_route
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- C4 — roteamento de ingestão por clínica (blindagem do canário na reconexão)
--
-- O whatsapp-orchestrator (ensureUazapiWebhooks) recria o webhook do n8n na
-- reconexão, gerando DUPLA ENTREGA nas clínicas já migradas para o hub. Esta
-- flag diz ao orchestrator qual destino usar para o evento 'messages':
--   'n8n' (default, não muda nada) | 'hub' (usa wa-inbound e remove n8n stale).
-- =============================================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_route text NOT NULL DEFAULT 'n8n';

-- Canário atual (São Lucas, MedDesk Comercial, Clínica Vaz) → hub
UPDATE public.whatsapp_instances
SET inbound_route = 'hub'
WHERE clinic_id IN (
  '97c7eb50-11a1-425f-b227-30a5de625d2b',
  '389e2eef-2bf5-4f2c-a260-56fdbf443291',
  '2c9c4e85-df66-41f6-b345-8b7ec94f0605'
);
