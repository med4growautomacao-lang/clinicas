-- CREATE OR REPLACE com assinatura diferente (p_ticket_id novo, migration anterior) criou um
-- OVERLOAD em vez de substituir — chegou a haver 2 versões de save_orcamento (16 e 17 params),
-- o que causaria erro de "could not choose the best candidate function" na chamada via
-- PostgREST. Derruba a antiga (verificado: só sobra a de 17 params, anon bloqueado, authenticated ok).
DROP FUNCTION IF EXISTS public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb);
