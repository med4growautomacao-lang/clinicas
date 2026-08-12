-- 20260720033132_memory_shield_dedup_9th_digit_tolerant
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- R2: dedup do turno humano do memory tolerante ao 9º dígito.
-- Raiz: edge wa-inbound grava telefone SEM o 9; n8n/memory grava COM o 9.
-- O shield antigo comparava session_id exato -> 9º dígito quebrava o match -> duplicata.
-- Agora: se existe linha CRUA (wa_message_id) recente do MESMO lead (telefone normalizado),
-- pula a linha do memory. Onde NÃO há linha crua (ex.: Lorena), continua inserindo (registro único).
create or replace function public.fn_memory_insert_shield()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id    uuid;
  v_clinic_phone text;
  v_lead_phone   text;
begin
  if NEW.message->>'type' = 'human' then
    -- deriva clinica + telefone do lead a partir do session_id (= clinic_phone || lead_phone)
    select clinic_id, phone_number
      into v_clinic_id, v_clinic_phone
    from whatsapp_instances
    where starts_with(NEW.session_id, phone_number)
    limit 1;

    v_lead_phone := case
      when v_clinic_phone is not null and starts_with(NEW.session_id, v_clinic_phone)
        then substr(NEW.session_id, length(v_clinic_phone) + 1)
      else NEW.session_id
    end;

    if exists (
      select 1 from chat_messages cm
      where cm.wa_message_id is not null
        and cm.created_at > (now() at time zone 'America/Sao_Paulo') - interval '15 minutes'
        and (
          cm.session_id = NEW.session_id  -- match exato (comportamento antigo)
          or (
            v_clinic_id is not null
            and cm.clinic_id = v_clinic_id
            and normalize_br_phone(cm.phone) = normalize_br_phone(v_lead_phone)  -- 9º-dígito-tolerante
          )
        )
    ) then
      return NEW;  -- turno humano já persistido pelo hub (linha crua) -> pula a duplicata
    end if;
  end if;

  insert into chat_messages (session_id, message)
  values (NEW.session_id, NEW.message);
  return NEW;
end;
$function$;
