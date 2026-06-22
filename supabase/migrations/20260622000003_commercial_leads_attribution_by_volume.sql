-- Painel Comercial — atribuição de lead por QUEM ENVIOU MAIS mensagens (não mais por "tocou").
--
-- Substitui a regra anterior (handoff=IA por presença de mensagem) por MAIORIA DE VOLUME:
--   IA      = nº de msgs da IA >= nº de msgs humanas de saída (e ao menos 1 resposta). Empate -> IA.
--   Humano  = nº de msgs humanas de saída > nº de msgs da IA.
--   Não atendidos = nenhuma resposta de saída (newLeads - IA - Humano).
-- Continua exclusivo e somando: entradas = IA + Humano + Não atendidos.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  -- 1) per_lead: contar mensagens por agente (em vez de bool_or)
  src := replace(src,
$a_old$      bool_or(cm.sender = 'ai') AS got_ia,
      bool_or(cm.sender = 'human' AND cm.direction = 'outbound') AS got_human$a_old$,
$a_new$      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_out,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_out$a_new$);

  -- 2) classificar por maioria de volume (empate -> IA)
  src := replace(src,
$c_old$  SELECT
    COUNT(*) FILTER (WHERE got_ia),
    COUNT(*) FILTER (WHERE got_human AND NOT got_ia)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;$c_old$,
$c_new$  SELECT
    COUNT(*) FILTER (WHERE (ai_out + human_out) > 0 AND ai_out >= human_out),
    COUNT(*) FILTER (WHERE human_out > ai_out)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;$c_new$);

  EXECUTE src;
END $do$;
