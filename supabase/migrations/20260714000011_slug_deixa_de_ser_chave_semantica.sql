-- O slug é TEXTO LIVRE digitado pela clínica — e o motor de agendamento o usava como CHAVE.
--
-- Quem define o slug: a própria clínica, na tela de tipos de consulta. Ele é derivado do NOME
-- (`slugify(name)`) e ainda pode ser editado à mão. Não havia validação nenhuma. Resultado: quem
-- cria um tipo chamado "Presencial" ganha o slug `presencial` — exatamente a palavra que o motor
-- trata como MODALIDADE. Hoje **14 dos 19 tipos** estão assim.
--
-- Nessas clínicas funciona por COINCIDÊNCIA (o slug calha de bater com a modalidade). Nas que
-- fugiram do padrão (Lorena: `primeira-consulta`, `seguimento`) a busca por 'presencial' não casava
-- com slug nenhum e voltava VAZIA — o falso "agenda cheia".
--
-- Três correções, da mais grave para a mais estrutural.

begin;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1) Proibir o slug que MENTE
--
-- Não proibimos a colisão (slug='presencial' + modality='presencial' é inofensivo e são 14 casos
-- legítimos). Proibimos a MENTIRA: um tipo com slug 'online' cuja modalidade seja presencial. Esse
-- caso não existe hoje, mas nada o impedia — e o motor, que tenta o slug primeiro, devolveria um
-- tipo PRESENCIAL para quem pediu "online".
--
-- Validado contra os dados atuais: 0 linhas violam.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.consultation_types
  add constraint consultation_types_slug_nao_mente
  check (slug not in ('presencial', 'online') or slug = lower(modality));

comment on constraint consultation_types_slug_nao_mente on public.consultation_types is
  'O slug pode colidir com o nome de uma modalidade, mas não pode MENTIR sobre ela: slug=online exige modality=online. Sem isso, um tipo presencial chamado "Online" seria devolvido para quem pede consulta online.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2) O ID vira a chave. O slug vira adaptador de legado.
--
-- Estava invertido: a versão por uuid resolvia o slug e DELEGAVA para a versão por texto, que era a
-- que continha a lógica. Ou seja, o caminho normal (id) passava obrigatoriamente por uma tradução
-- via texto livre. Agora é o contrário: a lógica mora na versão por ID; a versão por texto só
-- traduz e delega.
--
-- 🔧 E o mais importante: o buffer da consulta JÁ EXISTENTE também era descoberto pelo slug
--    (`ect.slug = COALESCE(a.consultation_type_slug, a.modality)`). Agora prefere o
--    `consultation_type_id` — que todas as 262 consultas já têm. O slug fica só como plano B para
--    dados antigos.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_consultation_type_id uuid,
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

  -- Chave inequívoca: o id. Sem tradução por texto no caminho principal.
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
      v_target_range := tsrange(v_slot_start, v_slot_end, '[)');

      IF NOT p_ignore_min_notice AND v_slot_start < v_min_allowed THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      -- Conflito respeitando os buffers dos DOIS tipos; o intervalo exigido é o MAIOR dos dois
      -- lados. O tipo da consulta existente é resolvido pelo ID (todas as 262 já têm); o slug fica
      -- só como plano B para dados antigos.
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

-- A versão por TEXTO vira só um adaptador de legado: traduz slug/modalidade → id e delega.
-- Nenhum código nosso deveria chamá-la (o app usa o id; a ai-scheduler resolve o tipo antes).
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
  v_id uuid;
BEGIN
  -- (1) É um SLUG?
  SELECT id INTO v_id
  FROM consultation_types
  WHERE doctor_id = p_doctor_id AND slug = p_modality;

  -- (2) Não é slug — então é uma MODALIDADE ('presencial'/'online'). Sem esta queda a função
  --     retornava VAZIO em silêncio e o chamador concluía "agenda cheia" com a agenda livre.
  --     Empate (primeira + seguimento na mesma modalidade): prefere PRIMEIRA — assumir seguimento
  --     para um paciente novo encurta a consulta e cobra errado.
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM consultation_types
    WHERE doctor_id = p_doctor_id
      AND is_active
      AND lower(modality) = lower(p_modality)
    ORDER BY (slug ILIKE '%primeira%') DESC, slug
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM public.get_available_slots(
    p_doctor_id, p_date, v_id, p_exclude_appointment_id, p_ignore_min_notice
  );
END;
$function$;

commit;
