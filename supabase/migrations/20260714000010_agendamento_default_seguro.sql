-- Duas correções no motor de agendamento, achadas auditando os 4 tipos da Lorena.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1) book_appointment: o DEFAULT passa a VALIDAR
--
-- Estava assim:
--     v_validate := COALESCE(p_validate_availability, (p_source = 'ia'));
--
-- Ou seja: **só a IA validava**. Com `p_source='manual'` a RPC não checava NADA — nem buffer, nem
-- expediente, nem folga, nem bloqueio. Comprovado em produção (transação abortada, Lorena): o
-- manual conseguiu marcar em segunda-feira SEM EXPEDIENTE, em DIA DE FOLGA declarado, às 03:00 da
-- manhã e DENTRO de um bloqueio — todos `success: true`. E violando o buffer de 15 min.
--
-- Hoje isso não explode só porque a UI é bem-comportada: os formulários de Consultas e do Kanban
-- **só oferecem horários vindos de `get_available_slots`**. Ninguém digita horário livre. Mas
-- qualquer chamador que não passe por essa lista (n8n, integração, script, bug de front) gravava
-- por cima de tudo, em silêncio.
--
-- Note a INCONSISTÊNCIA: a irmã `reschedule_appointment` já faz o certo — valida por padrão
-- (`p_force` default false), e o app opta por forçar EXPLICITAMENTE, com comentário justificando o
-- encaixe da recepção. Isso é uma decisão visível. O `book_appointment` era o único com o default
-- inseguro.
--
-- PRINCÍPIO: o default é seguro; forçar é explícito. Quem precisa furar a regra passa
-- `p_validate_availability => false` e assume.
--
-- O bypass do AVISO MÍNIMO continua (é intencional — encaixe no mesmo dia): manual segue com
-- `v_ignore_min = true`, exatamente como a UI já monta a lista de horários.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'book_appointment';

  -- Substituição cirúrgica: só a linha do default. O resto do corpo (idempotência, advisory lock,
  -- resolução de paciente/lead/ticket, tratamento de exclusion_violation) fica intacto.
  d2 := replace(
    d,
    'v_validate := COALESCE(p_validate_availability, (p_source=''ia''));',
    'v_validate := COALESCE(p_validate_availability, true);'
  );

  -- Guarda: se a linha do default nao existir mais, ABORTA em vez de reaplicar a funcao inalterada
  -- achando que corrigiu. Substituicao textual silenciosa e um jeito classico de nao consertar nada.
  if d2 = d then
    raise exception 'Linha do default nao encontrada — abortando.';
  end if;

  execute d2;
end $$;

commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2) get_available_slots(por modalidade): parava de responder em silêncio
--
-- A sobrecarga de texto casa **slug = p_modality**. Os slugs da Lorena são `primeira-online`,
-- `primeira-consulta`, `online` e `seguimento` — **`'presencial'` não é slug de NENHUM tipo**.
-- Resultado: `RETURN` vazio, sem erro. Quem chamasse assim concluía "agenda cheia" com a agenda
-- livre — o falso "sem horários", que é o pior tipo de bug: o paciente desiste sozinho.
--
-- Hoje nenhum chamador cai nisso (o app usa `p_consultation_type_id`; a `ai-scheduler` resolve o
-- tipo antes, em `findDoctorTypes`). Mas a mina segue armada para n8n/integração futura.
--
-- FIX: se o slug não casar, cair para a coluna `modality` — que é o que a `ai-scheduler` já faz em
-- TypeScript. Espelhamos a mesma regra, inclusive a preferência por "primeira" quando há empate
-- (mais seguro assumir primeira consulta do que seguimento para alguém novo).
--
-- ⚠️ A ordem importa: o slug é tentado PRIMEIRO. Isso preserva o caminho interno — a sobrecarga por
-- uuid resolve o slug real e delega para cá. Inverter a ordem faria `'online'` (slug do Seguimento
-- Online) ser tratado como modalidade e devolver a Primeira Online. Seria trocar um bug por outro.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_modality text default 'presencial',
  p_exclude_appointment_id uuid default null,
  p_ignore_min_notice boolean default false
)
returns table(slot_time time without time zone)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_duration int; v_step int;
  v_buffer_before int; v_buffer_after int; v_min_notice int;
  v_working jsonb; v_days_off jsonb; v_blocked jsonb;
  v_dow text; v_shift jsonb; v_blk jsonb;
  v_start_min int; v_end_min int; v_cur_min int;
  v_slot_start timestamp; v_slot_end timestamp;
  v_target_range tsrange; v_blk_range tsrange;
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

  -- (1) p_modality é um SLUG? (caminho normal — a sobrecarga por uuid delega para cá com o slug real)
  SELECT consultation_duration, slot_step, buffer_before_minutes, buffer_after_minutes,
         min_notice_minutes, is_active, working_hours_override
  INTO v_ct
  FROM consultation_types
  WHERE doctor_id = p_doctor_id AND slug = p_modality;

  -- (2) Não é slug — então é uma MODALIDADE ("presencial"/"online"). Sem este fallback a função
  --     retornava VAZIO em silêncio, e o chamador concluía "agenda cheia".
  IF NOT FOUND THEN
    SELECT consultation_duration, slot_step, buffer_before_minutes, buffer_after_minutes,
           min_notice_minutes, is_active, working_hours_override
    INTO v_ct
    FROM consultation_types
    WHERE doctor_id = p_doctor_id
      AND is_active
      AND lower(modality) = lower(p_modality)
    -- Empate (primeira + seguimento na mesma modalidade): prefere PRIMEIRA. Assumir seguimento para
    -- um paciente novo seria pior — encurta a consulta e cobra errado.
    ORDER BY (slug ILIKE '%primeira%') DESC, slug
    LIMIT 1;
  END IF;

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
      v_target_range := tsrange(v_slot_start, v_slot_end, '[)');

      IF NOT p_ignore_min_notice AND v_slot_start < v_min_allowed THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      -- Conflito respeitando buffers de AMBOS os tipos; gap = GREATEST dos dois lados.
      IF EXISTS (
        SELECT 1
        FROM appointments a
        LEFT JOIN consultation_types ect
          ON ect.doctor_id = p_doctor_id
         AND ect.slug = COALESCE(a.consultation_type_slug, a.modality)
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

      v_has_block_conflict := false;
      FOR v_blk IN SELECT * FROM jsonb_array_elements(v_blocked) WHERE value->>'date' = p_date::text
      LOOP
        v_blk_range := tsrange(
          (p_date + (v_blk->>'start')::time)::timestamp,
          (p_date + (v_blk->>'end')::time)::timestamp,
          '[)'
        );
        IF v_blk_range && v_target_range THEN
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
