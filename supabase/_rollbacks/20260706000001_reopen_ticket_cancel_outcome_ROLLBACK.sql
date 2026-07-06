-- Rollback de 20260706000001_reopen_ticket_cancel_outcome.sql
-- Remove a RPC reopen_ticket (aditiva; nenhuma alteração de schema foi feita).
DROP FUNCTION IF EXISTS public.reopen_ticket(uuid, uuid, boolean);
