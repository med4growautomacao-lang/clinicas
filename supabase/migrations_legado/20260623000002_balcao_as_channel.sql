-- Balcão passa a ser um CANAL (capture_channel='balcao'), não mais uma origem (source).
-- Conceito: origem = de onde veio (Meta/Google/Orgânico); canal = como foi captado (Forms/WhatsApp/Balcão).
-- Também adiciona o parâmetro p_channel ao filtro do painel Comercial (get_commercial_dashboard/leads).
-- O ramo de origem 'balcao' das RPCs (migration anterior) vira código morto inofensivo
-- (nenhum lead terá source='balcao' após a restauração).

-- ==========================================================================
-- A) Re-modelagem dos dados: restaura source original e marca capture_channel='balcao'
-- ==========================================================================
ALTER TABLE public.balcao_origin_backfill ADD COLUMN IF NOT EXISTS old_capture_channel text;

-- guarda o canal anterior (p/ reverter) antes de sobrescrever
UPDATE public.balcao_origin_backfill b
SET old_capture_channel = l.capture_channel
FROM public.leads l
WHERE l.id = b.lead_id AND b.old_capture_channel IS NULL;

-- restaura a origem original e move o balcão para a dimensão de canal
UPDATE public.leads l
SET source = b.old_source,
    capture_channel = 'balcao'
FROM public.balcao_origin_backfill b
WHERE l.id = b.lead_id AND l.source = 'balcao';

-- ==========================================================================
-- B) Trigger going-forward: marca capture_channel='balcao' (não mexe mais em source)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.fn_mark_balcao_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead uuid;
  v_src  text;
  v_ch   text;
BEGIN
  SELECT t.lead_id INTO v_lead FROM public.tickets t WHERE t.id = NEW.ticket_id;
  IF v_lead IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.source, l.capture_channel INTO v_src, v_ch FROM public.leads l WHERE l.id = v_lead;

  -- Balcão = sem origem paga, não captado por formulário, sem mensagem de entrada no WhatsApp.
  IF (v_src IS NULL OR v_src = 'manual')
     AND COALESCE(v_ch, '') <> 'forms'
     AND v_ch IS DISTINCT FROM 'balcao'
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_messages cm
       WHERE cm.lead_id = v_lead AND cm.direction = 'inbound'
     )
  THEN
    INSERT INTO public.balcao_origin_backfill(lead_id, old_source, old_capture_channel, via)
    VALUES (v_lead, v_src, v_ch, 'trigger')
    ON CONFLICT (lead_id) DO NOTHING;

    UPDATE public.leads
    SET capture_channel = 'balcao'
    WHERE id = v_lead AND capture_channel IS DISTINCT FROM 'balcao';
  END IF;

  RETURN NEW;
END;
$$;

-- ==========================================================================
-- C) Filtro de canal (p_channel) no painel Comercial.
--    Adiciona o parâmetro e injeta `AND (p_channel='todos' OR capture_channel=p_channel)`
--    após cada bloco de origem baseado em leads (aliases source / l.source; pula platform).
--    Recria a função com a nova assinatura e remove a antiga.
-- ==========================================================================
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);
  src := replace(src, 'p_origin text DEFAULT ''todos''::text)',
                      'p_origin text DEFAULT ''todos''::text, p_channel text DEFAULT ''todos''::text)');
  src := regexp_replace(src,
    '(\(l\.source IS NULL OR l\.source NOT IN \(''meta_ads'', ''google_ads'', ''balcao''\)\)\)\))',
    '\1 AND (p_channel = ''todos'' OR l.capture_channel = p_channel)', 'g');
  src := regexp_replace(src,
    '(\(source IS NULL OR source NOT IN \(''meta_ads'', ''google_ads'', ''balcao''\)\)\)\))',
    '\1 AND (p_channel = ''todos'' OR capture_channel = p_channel)', 'g');
  EXECUTE src;
END $do$;

DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid,date,date,date,date,text,text);

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_leads(uuid,date,date,date,date,text,text,integer,integer)'::regprocedure);
  src := replace(src, 'p_offset integer DEFAULT 0)',
                      'p_offset integer DEFAULT 0, p_channel text DEFAULT ''todos''::text)');
  src := regexp_replace(src,
    '(\(l\.source IS NULL OR l\.source NOT IN \(''meta_ads'', ''google_ads'', ''balcao''\)\)\)\))',
    '\1 AND (p_channel = ''todos'' OR l.capture_channel = p_channel)', 'g');
  src := regexp_replace(src,
    '(\(source IS NULL OR source NOT IN \(''meta_ads'', ''google_ads'', ''balcao''\)\)\)\))',
    '\1 AND (p_channel = ''todos'' OR capture_channel = p_channel)', 'g');
  EXECUTE src;
END $do$;

DROP FUNCTION IF EXISTS public.get_commercial_leads(uuid,date,date,date,date,text,text,integer,integer);
