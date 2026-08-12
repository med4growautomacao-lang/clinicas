-- 20260720044449_memory_shield_inbound_only_dedup
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Revisão 20/07: a prova de "turno humano já persistido pelo hub" deve ser uma linha
-- crua de ENTRADA (direction='inbound'). Sem esse filtro, um outbound fromMe da
-- recepcionista (que também tem wa_message_id) dentro da janela poderia suprimir
-- indevidamente o turno humano do memory. Cenário raro, correção barata.
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
        and cm.direction = 'inbound'
        and cm.created_at > (now() at time zone 'America/Sao_Paulo') - interval '15 minutes'
        and (
          cm.session_id = NEW.session_id
          or (
            v_clinic_id is not null
            and cm.clinic_id = v_clinic_id
            and normalize_br_phone(cm.phone) = normalize_br_phone(v_lead_phone)
          )
        )
    ) then
      return NEW;  -- inbound cru já persistido pelo hub -> pula a duplicata
    end if;
  end if;

  insert into chat_messages (session_id, message)
  values (NEW.session_id, NEW.message);
  return NEW;
end;
$function$;
