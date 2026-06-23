-- Canal Balcão não tem mídia paga: zera o investimento de anúncio quando p_channel='balcao'.
-- Sem isso, Custo por Agendamento, CAC e ROAS do Balcão usavam o investimento TOTAL da clínica
-- (que vem da tabela de investimento por 'platform', sem dimensão de canal), inflando esses cards.
-- Forms/WhatsApp mantêm o investimento por origem (podem ser tráfego pago).
-- Com investment=0 o frontend já mostra "—" em Custo/Agend., CAC e ROAS.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text)'::regprocedure);
  IF position('COALESCE(p_channel, ''todos'') <> ''balcao''' in src) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  src := regexp_replace(src,
    '(\(platform IS NULL OR platform NOT IN \(''meta_ads'', ''google_ads'', ''balcao''\)\)\)\))',
    '\1 AND (COALESCE(p_channel, ''todos'') <> ''balcao'')', 'g');
  EXECUTE src;
END $do$;
