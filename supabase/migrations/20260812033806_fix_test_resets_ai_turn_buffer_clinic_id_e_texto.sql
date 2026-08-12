-- 20260812033806_fix_test_resets_ai_turn_buffer_clinic_id_e_texto
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Corrige defeito da migration anterior, pego no teste antes de qualquer clique de cliente:
-- ai_turn_buffer.clinic_id é TEXT, não uuid, então `clinic_id = any(v_alvos)` estourava
-- "operator does not exist: text = uuid" e derrubava a função inteira.
-- Conserto: comparar com o array convertido para text.

create or replace function public.test_reset_full(p_phone text, p_clinic_id uuid default null)
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

  -- ai_turn_buffer.clinic_id é TEXT (não uuid): comparar com o array convertido.
  delete from ai_turn_buffer
   where clinic_id = any(v_alvos::text[])
     and session_id like '%' || v_phone;

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

create or replace function public.test_reset_for_rebook(p_phone text, p_clinic_id uuid default null)
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

  delete from ai_turn_buffer
   where clinic_id = any(v_alvos::text[])
     and session_id like '%' || v_phone;

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
