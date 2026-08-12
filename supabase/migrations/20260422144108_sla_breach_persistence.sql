-- 20260422144108_sla_breach_persistence
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ============================================================
-- 1. Função auxiliar: calcula minutos úteis entre dois timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION public.calc_business_minutes(
  p_from    TIMESTAMP WITHOUT TIME ZONE,
  p_to      TIMESTAMP WITHOUT TIME ZONE,
  p_sh      INTEGER,   -- hora início expediente (ex: 8)
  p_sm      INTEGER,   -- minuto início expediente (ex: 0)
  p_eh      INTEGER,   -- hora fim expediente (ex: 18)
  p_em      INTEGER,   -- minuto fim expediente (ex: 0)
  p_days    INTEGER[]  -- dias úteis (0=dom..6=sab, ex: ARRAY[1,2,3,4,5])
)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_cur       TIMESTAMP;
  v_total     INTEGER := 0;
  v_start_m   INTEGER;
  v_end_m     INTEGER;
  v_cur_m     INTEGER;
  v_guard     INTEGER := 0;
BEGIN
  IF p_from >= p_to THEN RETURN 0; END IF;

  v_start_m := p_sh * 60 + p_sm;
  v_end_m   := p_eh * 60 + p_em;
  v_cur     := p_from;

  -- Se iniciou antes do expediente num dia útil, avança para o início
  IF EXTRACT(DOW FROM v_cur)::INTEGER = ANY(p_days) THEN
    v_cur_m := EXTRACT(HOUR FROM v_cur)::INTEGER * 60 + EXTRACT(MINUTE FROM v_cur)::INTEGER;
    IF v_cur_m < v_start_m THEN
      v_cur := DATE_TRUNC('day', v_cur) + make_interval(mins => v_start_m);
    END IF;
  END IF;

  WHILE v_cur < p_to AND v_guard < 10000 LOOP
    v_guard := v_guard + 1;

    IF EXTRACT(DOW FROM v_cur)::INTEGER = ANY(p_days) THEN
      v_cur_m := EXTRACT(HOUR FROM v_cur)::INTEGER * 60 + EXTRACT(MINUTE FROM v_cur)::INTEGER;

      IF v_cur_m >= v_start_m AND v_cur_m < v_end_m THEN
        v_total := v_total + LEAST(
          v_end_m - v_cur_m,
          CEIL(EXTRACT(EPOCH FROM (p_to - v_cur)) / 60)::INTEGER
        );
        -- Avança para o fim do expediente deste dia
        v_cur := DATE_TRUNC('day', v_cur) + make_interval(mins => v_end_m);
        CONTINUE;
      END IF;
    END IF;

    -- Avança para o início do próximo dia
    v_cur := DATE_TRUNC('day', v_cur) + INTERVAL '1 day' + make_interval(mins => v_start_m);
  END LOOP;

  RETURN v_total;
END;
$$;


-- ============================================================
-- 2. Trigger: persiste sla_breach_count quando ciclo fecha com breach
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_track_sla_breach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sla_minutes  INTEGER;
  v_bh           JSONB;
  v_sh INTEGER; v_sm INTEGER;
  v_eh INTEGER; v_em INTEGER;
  v_days         INTEGER[];
  v_biz_mins     INTEGER;
BEGIN
  -- Só processa quando last_outbound_at muda
  IF NEW.last_outbound_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.last_outbound_at IS NOT DISTINCT FROM NEW.last_outbound_at THEN RETURN NEW; END IF;
  IF NEW.last_message_at IS NULL THEN RETURN NEW; END IF;

  -- O ciclo fecha quando o outbound é POSTERIOR à última mensagem recebida
  IF NEW.last_outbound_at <= NEW.last_message_at THEN RETURN NEW; END IF;

  -- O ciclo anterior precisava estar aberto (sem outbound após a mensagem)
  IF OLD.last_outbound_at IS NOT NULL
     AND OLD.last_outbound_at >= NEW.last_message_at THEN
    RETURN NEW;
  END IF;

  -- Busca config de SLA da clínica
  SELECT a.sla_minutes, a.business_hours
  INTO v_sla_minutes, v_bh
  FROM ai_config a
  WHERE a.clinic_id = NEW.clinic_id
  LIMIT 1;

  IF v_sla_minutes IS NULL OR v_sla_minutes <= 0 OR v_bh IS NULL THEN
    RETURN NEW;
  END IF;

  -- Extrai horas/minutos do expediente
  v_sh := SPLIT_PART(v_bh->>'start', ':', 1)::INTEGER;
  v_sm := COALESCE(NULLIF(SPLIT_PART(v_bh->>'start', ':', 2), ''), '0')::INTEGER;
  v_eh := SPLIT_PART(v_bh->>'end',   ':', 1)::INTEGER;
  v_em := COALESCE(NULLIF(SPLIT_PART(v_bh->>'end',   ':', 2), ''), '0')::INTEGER;

  SELECT ARRAY_AGG(d::INTEGER)
  INTO v_days
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_bh->'days') d;

  -- Calcula minutos úteis entre a mensagem recebida e a resposta enviada
  v_biz_mins := calc_business_minutes(
    NEW.last_message_at,
    NEW.last_outbound_at,
    v_sh, v_sm, v_eh, v_em, v_days
  );

  IF v_biz_mins > v_sla_minutes THEN
    NEW.sla_breach_count := COALESCE(NEW.sla_breach_count, 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_track_sla_breach
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_track_sla_breach();
