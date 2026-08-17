-- Bloqueio da agenda (compromisso pessoal do medico) passa a ser comparado contra o
-- intervalo que a consulta REALMENTE ocupa, buffers incluidos.
--
-- Antes, o conflito com outra CONSULTA ja somava os buffers dos dois lados, mas o
-- conflito com BLOQUEIO comparava so [inicio, fim) da consulta. Com isso o motor
-- oferecia (e a IA marcava) horario que termina colado no compromisso e invade com o
-- buffer de depois, e horario que comeca colado no fim do compromisso e invade com o
-- buffer de antes. Caso real: Lorena Barros, 21/08/2026, consulta 16:00-17:00 com 15 min
-- de buffer depois, contra bloqueio 17:00-18:30.
--
-- Continua PROPOSITAL nao aplicar buffer contra o inicio/fim do EXPEDIENTE: o intervalo
-- antes da primeira consulta do dia e depois da ultima nao precisa caber dentro do
-- expediente, e exigir isso apagaria o primeiro horario (09:00, 14:00), usado na rotina.
CREATE OR REPLACE FUNCTION public.get_available_slots(p_doctor_id uuid, p_date date, p_consultation_type_id uuid, p_exclude_appointment_id uuid DEFAULT NULL::uuid, p_ignore_min_notice boolean DEFAULT false)
 RETURNS TABLE(slot_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_duration int; v_step int;
  v_buffer_before int; v_buffer_after int; v_min_notice int;
  v_working jsonb; v_days_off jsonb; v_blocked jsonb;
  v_dow text; v_shift jsonb; v_blk jsonb;
  v_start_min int; v_end_min int; v_cur_min int;
  v_slot_start timestamp; v_slot_end timestamp;
  v_block_probe tsrange; v_blk_range tsrange;
  v_blk_ini time; v_blk_fim time;
  v_has_block_conflict boolean;
  v_now_sp timestamp;
  v_min_allowed timestamp;
  v_ct RECORD;
BEGIN
  SELECT
    COALESCE(working_hours, '{}'::jsonb),
    COALESCE(days_off, '[]'::jsonb),
    COALESCE(blocked_times, '[]'::jsonb)
  INTO v_working, v_days_off, v_blocked
  FROM doctors WHERE id = p_doctor_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- Chave inequivoca: o id. Sem traducao por texto no caminho principal.
  SELECT consultation_duration, slot_step, buffer_before_minutes, buffer_after_minutes,
         min_notice_minutes, is_active, working_hours_override
  INTO v_ct
  FROM consultation_types
  WHERE id = p_consultation_type_id AND doctor_id = p_doctor_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_ct.is_active = false THEN RETURN; END IF;

  v_duration := v_ct.consultation_duration;
  v_step := COALESCE(v_ct.slot_step, v_duration);
  v_buffer_before := COALESCE(v_ct.buffer_before_minutes, 0);
  v_buffer_after := COALESCE(v_ct.buffer_after_minutes, 0);
  v_min_notice := v_ct.min_notice_minutes;

  IF v_ct.working_hours_override IS NOT NULL THEN
    v_working := v_ct.working_hours_override;
  END IF;

  IF v_days_off @> to_jsonb(p_date::text) THEN RETURN; END IF;

  v_now_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp;
  v_min_allowed := v_now_sp + make_interval(mins => v_min_notice);

  v_dow := EXTRACT(DOW FROM p_date)::int::text;

  FOR v_shift IN SELECT * FROM jsonb_array_elements(COALESCE(v_working->v_dow, '[]'::jsonb))
  LOOP
    v_start_min := EXTRACT(HOUR FROM (v_shift->>'start')::time) * 60
                 + EXTRACT(MINUTE FROM (v_shift->>'start')::time);
    v_end_min   := EXTRACT(HOUR FROM (v_shift->>'end')::time) * 60
                 + EXTRACT(MINUTE FROM (v_shift->>'end')::time);

    v_cur_min := v_start_min;
    WHILE v_cur_min + v_duration <= v_end_min LOOP
      v_slot_start := (p_date + make_time(v_cur_min / 60, v_cur_min % 60, 0))::timestamp;
      v_slot_end   := v_slot_start + make_interval(mins => v_duration);

      IF NOT p_ignore_min_notice AND v_slot_start < v_min_allowed THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      -- Conflito respeitando os buffers dos DOIS tipos; intervalo exigido = MAIOR dos dois lados.
      -- O tipo da consulta existente e resolvido pelo ID; o slug fica so como plano B (dados antigos).
      IF EXISTS (
        SELECT 1
        FROM appointments a
        LEFT JOIN LATERAL (
          SELECT ct.buffer_before_minutes, ct.buffer_after_minutes
          FROM consultation_types ct
          WHERE ct.id = a.consultation_type_id
             OR (a.consultation_type_id IS NULL
                 AND ct.doctor_id = p_doctor_id
                 AND ct.slug = COALESCE(a.consultation_type_slug, a.modality))
          ORDER BY (ct.id = a.consultation_type_id) DESC
          LIMIT 1
        ) ect ON true
        WHERE a.doctor_id = p_doctor_id
          AND a.status NOT IN ('cancelado', 'faltou')
          AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
          AND v_slot_start < upper(a.slot_range)
                + make_interval(mins => GREATEST(COALESCE(ect.buffer_after_minutes, 0), v_buffer_before))
          AND v_slot_end   > lower(a.slot_range)
                - make_interval(mins => GREATEST(COALESCE(ect.buffer_before_minutes, 0), v_buffer_after))
      ) THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      -- Bloqueio e compromisso REAL: o que precisa estar livre e a consulta MAIS os buffers.
      v_block_probe := tsrange(
        v_slot_start - make_interval(mins => v_buffer_before),
        v_slot_end   + make_interval(mins => v_buffer_after),
        '[)'
      );

      v_has_block_conflict := false;
      FOR v_blk IN SELECT * FROM jsonb_array_elements(v_blocked) WHERE value->>'date' = p_date::text
      LOOP
        v_blk_ini := (v_blk->>'start')::time;
        v_blk_fim := (v_blk->>'end')::time;
        -- Bloqueio invertido ou vazio: a tela nao impede digitar "das 18:00 as 09:00".
        -- Ignorar o registro em vez de deixar o tsrange estourar e derrubar a agenda do dia
        -- inteira (o sintoma seria "nao ha horario nenhum", sem erro visivel).
        CONTINUE WHEN v_blk_ini IS NULL OR v_blk_fim IS NULL OR v_blk_fim <= v_blk_ini;
        v_blk_range := tsrange(
          (p_date + v_blk_ini)::timestamp,
          (p_date + v_blk_fim)::timestamp,
          '[)'
        );
        IF v_blk_range && v_block_probe THEN
          v_has_block_conflict := true; EXIT;
        END IF;
      END LOOP;

      IF NOT v_has_block_conflict THEN
        slot_time := make_time(v_cur_min / 60, v_cur_min % 60, 0);
        RETURN NEXT;
      END IF;

      v_cur_min := v_cur_min + v_step;
    END LOOP;
  END LOOP;
END;
$function$;
