-- 20260812033633_endurece_test_resets_escopo_clinica_lista_e_auditoria
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Endurece as duas RPCs de reset de contato de teste, SEM tirar a ferramenta do cliente.
--
-- Medido antes (transação revertida, assumindo a identidade do super-admin): um clique apagava
-- 10 leads em 7 CLÍNICAS, porque as funções filtravam só por telefone. Quem tem acesso a várias
-- clínicas (o dono) reiniciava o teste de uma e perdia o das outras, sem aviso.
--
-- Mudanças:
--   1. escopo por clínica (novo p_clinic_id, com DEFAULT NULL para o app publicado não quebrar);
--   2. o telefone PRECISA estar em ai_config.test_numbers da clínica alvo (impede apagar o
--      histórico de um paciente real digitado por engano na caixa);
--   3. só gestor, medico_gestor e super-admin podem executar;
--   4. registra quem executou em test_reset_log;
--   5. recusa com mensagem explícita em vez de devolver "nada a apagar".
-- NÃO normalizo o telefone de propósito: normalizar aumentaria o alcance do apagamento, e os 7
-- números cadastrados hoje casam exatamente (conferido).

-- ---------------------------------------------------------------- 1. auditoria
create table if not exists public.test_reset_log (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  executed_by uuid,
  phone       text not null,
  mode        text not null,
  deleted     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ix_test_reset_log_clinic
  on public.test_reset_log (clinic_id, created_at desc);

alter table public.test_reset_log enable row level security;

drop policy if exists test_reset_log_select on public.test_reset_log;
create policy test_reset_log_select on public.test_reset_log
  for select to authenticated
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

drop policy if exists test_reset_log_insert on public.test_reset_log;
create policy test_reset_log_insert on public.test_reset_log
  for insert to authenticated
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

revoke all on table public.test_reset_log from public, anon;
grant select, insert on table public.test_reset_log to authenticated;

comment on table public.test_reset_log is
  'Registro de quem reiniciou contato de teste (test_reset_full / test_reset_for_rebook). Sem UPDATE/DELETE de propósito: é registro, não rascunho.';

-- ------------------------------------------------- 2. quais clínicas o clique pode tocar
create or replace function public.fn_test_reset_target_clinics(p_phone text, p_clinic_id uuid)
returns uuid[]
language sql
stable
security invoker
set search_path to 'public'
as $$
  select array_agg(distinct a.clinic_id)
  from public.ai_config a
  where p_phone = any(a.test_numbers)
    and (p_clinic_id is null or a.clinic_id = p_clinic_id)
    and (
      (select public.is_super_admin())
      or exists (
        select 1 from public.clinic_users cu
        where cu.id = auth.uid()
          and cu.clinic_id = a.clinic_id
          and coalesce(cu.is_active, true)
          and cu.role in ('gestor', 'medico_gestor')
      )
    );
$$;

comment on function public.fn_test_reset_target_clinics(text, uuid) is
  'Clínicas em que o telefone está cadastrado como número de teste E o usuário pode reiniciar. Vazio = recusa.';

revoke all on function public.fn_test_reset_target_clinics(text, uuid) from public, anon;
grant execute on function public.fn_test_reset_target_clinics(text, uuid) to authenticated;

-- ---------------------------------------------------------------- 3. reset completo
drop function if exists public.test_reset_full(text);

create function public.test_reset_full(p_phone text, p_clinic_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'extensions'
as $function$
declare
  v_phone       text := btrim(coalesce(p_phone, ''));
  v_alvos       uuid[];
  v_lead_ids    uuid[];
  v_patient_ids uuid[];
  v_appt_ids    uuid[];
  v_ticket_ids  uuid[];
  v_msgs        int;
  v_deleted     jsonb;
begin
  if v_phone = '' then
    raise exception 'Informe o telefone do contato de teste.' using errcode = '22023';
  end if;

  v_alvos := public.fn_test_reset_target_clinics(v_phone, p_clinic_id);

  if coalesce(array_length(v_alvos, 1), 0) = 0 then
    raise exception 'Reset recusado: este número não está na lista de números de teste desta clínica, ou seu usuário não tem permissão (apenas gestor). Cadastre o número em Configurações IA antes de reiniciar.'
      using errcode = '42501';
  end if;

  select array_agg(id) into v_lead_ids    from leads    where phone = v_phone and clinic_id = any(v_alvos);
  select array_agg(id) into v_patient_ids from patients where phone = v_phone and clinic_id = any(v_alvos);

  select array_agg(id) into v_appt_ids
    from appointments
   where clinic_id = any(v_alvos)
     and patient_id = any(coalesce(v_patient_ids, array[]::uuid[]));

  select array_agg(id) into v_ticket_ids
    from tickets
   where clinic_id = any(v_alvos)
     and (lead_id = any(coalesce(v_lead_ids, array[]::uuid[]))
          or id in (select ticket_id from appointments
                     where id = any(coalesce(v_appt_ids, array[]::uuid[])) and ticket_id is not null));

  delete from financial_transactions
   where clinic_id = any(v_alvos)
     and (appointment_id = any(coalesce(v_appt_ids, array[]::uuid[]))
          or patient_id = any(coalesce(v_patient_ids, array[]::uuid[])));
  delete from medical_records where clinic_id = any(v_alvos) and patient_id = any(coalesce(v_patient_ids, array[]::uuid[]));
  delete from prescriptions   where clinic_id = any(v_alvos) and patient_id = any(coalesce(v_patient_ids, array[]::uuid[]));
  delete from exam_requests   where clinic_id = any(v_alvos) and patient_id = any(coalesce(v_patient_ids, array[]::uuid[]));
  delete from appointments    where id = any(coalesce(v_appt_ids, array[]::uuid[]));
  delete from tickets         where id = any(coalesce(v_ticket_ids, array[]::uuid[]));
  delete from conversions     where clinic_id = any(v_alvos) and lead_id = any(coalesce(v_lead_ids, array[]::uuid[]));

  delete from chat_messages
   where clinic_id = any(v_alvos)
     and (phone = v_phone or lead_id = any(coalesce(v_lead_ids, array[]::uuid[])));
  get diagnostics v_msgs = row_count;

  delete from leads    where id = any(coalesce(v_lead_ids, array[]::uuid[]));
  delete from patients where id = any(coalesce(v_patient_ids, array[]::uuid[]));
  delete from ai_turn_buffer where clinic_id = any(v_alvos) and session_id like '%' || v_phone;

  v_deleted := jsonb_build_object(
    'leads',         coalesce(array_length(v_lead_ids, 1), 0),
    'patients',      coalesce(array_length(v_patient_ids, 1), 0),
    'appointments',  coalesce(array_length(v_appt_ids, 1), 0),
    'tickets',       coalesce(array_length(v_ticket_ids, 1), 0),
    'chat_messages', v_msgs
  );

  insert into public.test_reset_log (clinic_id, executed_by, phone, mode, deleted)
  select u, auth.uid(), v_phone, 'full', v_deleted from unnest(v_alvos) u;

  return jsonb_build_object(
    'success', true,
    'mode',    'full_reset',
    'phone',   v_phone,
    'clinics', coalesce(array_length(v_alvos, 1), 0),
    'deleted', v_deleted
  );
end;
$function$;

comment on function public.test_reset_full(text, uuid) is
  'Ferramenta do CLIENTE: reinicia um contato de TESTE (primeiro contato). Só apaga na clínica informada, só se o telefone estiver em ai_config.test_numbers dela, só para gestor/medico_gestor/super-admin, e registra em test_reset_log.';

revoke all on function public.test_reset_full(text, uuid) from public, anon;
grant execute on function public.test_reset_full(text, uuid) to authenticated;

-- ---------------------------------------------------------------- 4. reset de reagendamento
drop function if exists public.test_reset_for_rebook(text);

create function public.test_reset_for_rebook(p_phone text, p_clinic_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'extensions'
as $function$
declare
  v_phone     text := btrim(coalesce(p_phone, ''));
  v_alvos     uuid[];
  v_lead_ids  uuid[];
  v_open      uuid[];
  v_msgs      int;
  v_deleted   jsonb;
begin
  if v_phone = '' then
    raise exception 'Informe o telefone do contato de teste.' using errcode = '22023';
  end if;

  v_alvos := public.fn_test_reset_target_clinics(v_phone, p_clinic_id);

  if coalesce(array_length(v_alvos, 1), 0) = 0 then
    raise exception 'Reset recusado: este número não está na lista de números de teste desta clínica, ou seu usuário não tem permissão (apenas gestor). Cadastre o número em Configurações IA antes de reiniciar.'
      using errcode = '42501';
  end if;

  select array_agg(id) into v_lead_ids from leads where phone = v_phone and clinic_id = any(v_alvos);

  select array_agg(id) into v_open
    from tickets
   where clinic_id = any(v_alvos)
     and lead_id = any(coalesce(v_lead_ids, array[]::uuid[]))
     and status <> 'closed';

  update tickets
     set status     = 'closed',
         closed_at  = coalesce(closed_at, now()),
         outcome    = coalesce(outcome, 'perdido'),
         outcome_at = coalesce(outcome_at, now())
   where id = any(coalesce(v_open, array[]::uuid[]));

  delete from chat_messages
   where clinic_id = any(v_alvos)
     and (phone = v_phone or lead_id = any(coalesce(v_lead_ids, array[]::uuid[])));
  get diagnostics v_msgs = row_count;

  delete from leads where id = any(coalesce(v_lead_ids, array[]::uuid[]));
  delete from ai_turn_buffer where clinic_id = any(v_alvos) and session_id like '%' || v_phone;

  v_deleted := jsonb_build_object(
    'leads',         coalesce(array_length(v_lead_ids, 1), 0),
    'chat_messages', v_msgs
  );

  insert into public.test_reset_log (clinic_id, executed_by, phone, mode, deleted)
  select u, auth.uid(), v_phone, 'rebook', v_deleted from unnest(v_alvos) u;

  return jsonb_build_object(
    'success',        true,
    'mode',           'rebook_reset',
    'phone',          v_phone,
    'clinics',        coalesce(array_length(v_alvos, 1), 0),
    'deleted',        v_deleted,
    'closed_tickets', coalesce(array_length(v_open, 1), 0),
    'preserved',      jsonb_build_array('patients', 'appointments', 'conversions', 'financial_transactions', 'medical_records')
  );
end;
$function$;

comment on function public.test_reset_for_rebook(text, uuid) is
  'Ferramenta do CLIENTE: reinicia o contato de TESTE mantendo paciente, agendamentos e financeiro. Mesmas travas de test_reset_full.';

revoke all on function public.test_reset_for_rebook(text, uuid) from public, anon;
grant execute on function public.test_reset_for_rebook(text, uuid) to authenticated;
