-- 20260729015749_drop_colunas_letra_morta_doctors
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove de public.doctors as 4 colunas de agendamento que sobraram da epoca em que a
-- configuracao morava no medico. Hoje ela mora em consultation_types, e o motor de horarios
-- (get_available_slots) le duracao, passo, buffers e aviso minimo de la. De doctors ele so
-- usa working_hours, days_off e blocked_times.
--
-- PROVA DE QUE SAO LETRA MORTA (conferida no banco vivo e no repo):
--   . pg_proc.prosrc em TODOS os schemas: a unica funcao que cita slot_step, min_notice_minutes,
--     buffer_before_minutes ou buffer_after_minutes e get_available_slots, e la os quatro saem
--     de consultation_types, nao de doctors.
--   . pg_depend por attnum: slot_step tem 0 dependencias; as outras tres tem so o proprio DEFAULT.
--   . views, matviews, policies, constraints, indices, triggers, colunas geradas, cron: 0.
--   . Nenhuma funcao faz SELECT * em doctors nem doctors%ROWTYPE (unicos leitores invisiveis a grep).
--   . Repo e edge functions deployadas: nenhuma leitura; so a declaracao de tipo @deprecated.
--
-- O QUE NAO ENTRA AQUI, DE PROPOSITO: doctors.consultation_duration.
-- Ela NAO e letra morta, ao contrario do que o CLAUDE.md afirmava. E lida hoje em tres lugares
-- vivos: book_appointment, reschedule_appointment e a trigger habilitada
-- trg_appointment_inherit_doctor_duration. Dropar essa coluna nao falharia na migration;
-- falharia na PRIMEIRA marcacao de consulta, em producao. A GUARDA 3 existe para desfazer tudo
-- caso alguem inclua essa coluna na lista.
--
-- DADO DESCARTADO (medido antes): min_notice_minutes, buffer_before_minutes e buffer_after_minutes
-- valem 0 em todos os medicos, perda zero. slot_step tem valor em 4, todos obsoletos (3 da clinica
-- de demonstracao e 1 cujos tipos de consulta, que sao os que valem, usam outro passo).
-- Os valores estao no rollback abaixo.

set lock_timeout = '5s';

do $$
declare
  v_ofensor text;
begin
  -- GUARDA 1 (fail-closed): varias sessoes mexem neste banco. Se outra criou funcao nova lendo
  -- alguma das colunas alvo depois da auditoria, aborta e nada e aplicado.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_ofensor
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.proname <> 'get_available_slots'
    and p.prosrc ~* '(slot_step|min_notice_minutes|buffer_before_minutes|buffer_after_minutes)';

  if v_ofensor is not null then
    raise exception 'ABORTADO: apareceu leitor novo das colunas alvo desde a auditoria: %. Reveja antes de dropar.', v_ofensor;
  end if;

  -- GUARDA 2 (fail-closed): consultation_duration precisa existir ANTES.
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.doctors'::regclass
      and attname = 'consultation_duration'
      and not attisdropped
  ) then
    raise exception 'ABORTADO: doctors.consultation_duration ja nao existe. Ela e lida por book_appointment, reschedule_appointment e fn_appointment_inherit_doctor_duration.';
  end if;

  execute 'alter table public.doctors drop column if exists slot_step';
  execute 'alter table public.doctors drop column if exists min_notice_minutes';
  execute 'alter table public.doctors drop column if exists buffer_before_minutes';
  execute 'alter table public.doctors drop column if exists buffer_after_minutes';

  -- GUARDA 3: consultation_duration continua viva DEPOIS. O bloco DO roda como UMA instrucao,
  -- entao esta excecao desfaz os 4 drops acima. E a trava contra alguem editar a lista e
  -- incluir a coluna que quebra o agendamento inteiro.
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.doctors'::regclass
      and attname = 'consultation_duration'
      and not attisdropped
  ) then
    raise exception 'ABORTADO: consultation_duration foi removida por engano. Nada foi aplicado.';
  end if;
end
$$;

reset lock_timeout;

-- Recarrega o cache de schema do PostgREST para a API parar de anunciar as colunas removidas.
notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
-- alter table public.doctors add column if exists slot_step int;
-- alter table public.doctors add column if exists min_notice_minutes    int not null default 0;
-- alter table public.doctors add column if exists buffer_before_minutes int not null default 0;
-- alter table public.doctors add column if exists buffer_after_minutes  int not null default 0;
-- update public.doctors set slot_step = 30 where id = '22222222-2222-2222-2222-222222222001';
-- update public.doctors set slot_step = 30 where id = '22222222-2222-2222-2222-222222222002';
-- update public.doctors set slot_step = 60 where id = '22222222-2222-2222-2222-222222222003';
-- update public.doctors set slot_step = 30 where id = 'a3eb1894-0fe0-436c-b9ff-bee8ba85caf5';
-- notify pgrst, 'reload schema';
-- ============================================================================;
