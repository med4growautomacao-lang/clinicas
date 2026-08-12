-- Nova origem "Balcão": leads que NÃO chamaram no WhatsApp (sem mensagem de entrada)
-- mas para os quais foi gerado um agendamento (walk-in / atendimento de balcão).
--
-- Decisões (ver conversa 23/06):
--   * Escopo: só converte leads SEM origem paga (source NULL ou 'manual'). Meta/Google
--     mantêm a atribuição do anúncio (os candidatos pagos eram todos da clínica demo).
--   * Persistência: grava leads.source = 'balcao' (origem armazenada, não derivada).
--   * Reversível: o source anterior fica em balcao_origin_backfill.
--   * Going-forward: trigger em appointments marca automaticamente novos balcões.

-- ==========================================================================
-- 1) Backup do source original (para reverter)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.balcao_origin_backfill (
  lead_id    uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  old_source text,
  via        text NOT NULL DEFAULT 'backfill',   -- 'backfill' | 'trigger'
  marked_at  timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 2) Trigger: ao criar um agendamento, marca o lead como balcão se ele
--    não tem origem paga e nunca enviou mensagem no WhatsApp.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.fn_mark_balcao_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead uuid;
  v_src  text;
BEGIN
  SELECT t.lead_id INTO v_lead FROM public.tickets t WHERE t.id = NEW.ticket_id;
  IF v_lead IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.source INTO v_src FROM public.leads l WHERE l.id = v_lead;

  IF (v_src IS NULL OR v_src = 'manual')
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_messages cm
       WHERE cm.lead_id = v_lead AND cm.direction = 'inbound'
     )
  THEN
    INSERT INTO public.balcao_origin_backfill(lead_id, old_source, via)
    VALUES (v_lead, v_src, 'trigger')
    ON CONFLICT (lead_id) DO NOTHING;

    UPDATE public.leads
    SET source = 'balcao'
    WHERE id = v_lead AND source IS DISTINCT FROM 'balcao';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_balcao_origin ON public.appointments;
CREATE TRIGGER trg_mark_balcao_origin
AFTER INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.fn_mark_balcao_origin();

-- ==========================================================================
-- 3) Backfill dos leads históricos
-- ==========================================================================
INSERT INTO public.balcao_origin_backfill(lead_id, old_source, via)
SELECT l.id, l.source, 'backfill'
FROM public.leads l
WHERE (l.source IS NULL OR l.source = 'manual')
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_messages cm
    WHERE cm.lead_id = l.id AND cm.direction = 'inbound'
  )
  AND EXISTS (
    SELECT 1 FROM public.appointments ap
    JOIN public.tickets t ON t.id = ap.ticket_id
    WHERE t.lead_id = l.id
  )
ON CONFLICT (lead_id) DO NOTHING;

UPDATE public.leads
SET source = 'balcao'
WHERE id IN (SELECT lead_id FROM public.balcao_origin_backfill WHERE via = 'backfill')
  AND source IS DISTINCT FROM 'balcao';

-- ==========================================================================
-- 4) Reconhece 'balcao' no filtro de origem das RPCs.
--    As funções usam pg_get_functiondef + regex: adiciona o ramo positivo de
--    'balcao' e exclui 'balcao' do bucket 'sem_origem'. Idempotente.
--    Cobre os 3 aliases usados (source / l.source / platform).
-- ==========================================================================
DO $do$
DECLARE
  fn  text;
  src text;
  fns text[] := ARRAY[
    'public.get_commercial_dashboard(uuid,date,date,date,date,text,text)',
    'public.get_commercial_leads(uuid,date,date,date,date,text,text,integer,integer)',
    'public.get_dashboard_stats(uuid,date,date,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    src := pg_get_functiondef(fn::regprocedure);

    -- pula se já aplicado
    IF position('p_origin = ''balcao''' in src) > 0 THEN
      CONTINUE;
    END IF;

    -- 4a) exclui 'balcao' do sem_origem (normaliza com/sem espaço)
    src := regexp_replace(
      src,
      'NOT IN \(''meta_ads'',\s*''google_ads''\)',
      'NOT IN (''meta_ads'', ''google_ads'', ''balcao'')',
      'g'
    );

    -- 4b) injeta o ramo positivo de balcao antes do ramo sem_origem,
    --     reaproveitando o mesmo alias de coluna (\1 = source | l.source | platform)
    src := regexp_replace(
      src,
      'OR \(p_origin = ''sem_origem'' AND \(([a-zA-Z_.]+) IS NULL',
      'OR (p_origin = ''balcao'' AND \1 = ''balcao'')' || E'\n      ' ||
      'OR (p_origin = ''sem_origem'' AND (\1 IS NULL',
      'g'
    );

    EXECUTE src;
  END LOOP;
END $do$;
