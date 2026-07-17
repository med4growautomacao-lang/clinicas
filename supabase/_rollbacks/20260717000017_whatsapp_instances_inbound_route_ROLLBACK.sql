-- Rollback da 20260717000017 — remove a flag de roteamento.
-- ATENÇÃO: só reverter junto com o redeploy da versão anterior do
-- whatsapp-orchestrator (que ignora inbound_route), senão o orchestrator lê
-- coluna inexistente. Enquanto houver canário no hub, NÃO reverter (reintroduz
-- a dupla entrega na reconexão).
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS inbound_route;
