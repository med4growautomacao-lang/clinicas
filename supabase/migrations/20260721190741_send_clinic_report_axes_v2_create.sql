-- 20260721190741_send_clinic_report_axes_v2_create
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.send_clinic_report(
  p_clinic_id uuid,
  p_kind text DEFAULT 'completo'::text,
  p_entry_from date DEFAULT NULL::date,
  p_entry_to date DEFAULT NULL::date,
  p_agenda_from date DEFAULT NULL::date,
  p_agenda_to date DEFAULT NULL::date,
  p_conv_from date DEFAULT NULL::date,
  p_conv_to date DEFAULT NULL::date,
  p_trigger text DEFAULT 'manual'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_token text;
  v_status text;
  v_recipients text[];
  v_text text;
  v_num text;
  v_norm text;
  v_sent int := 0;
begin
  if auth.uid() is not null then
    if not (
      is_super_admin()
      or is_clinic_admin(p_clinic_id)
      or exists (select 1 from clinics c join org_users ou on ou.organization_id = c.organization_id
                 where c.id = p_clinic_id and ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner'))
    ) then
      raise exception 'sem permissão para enviar relatório desta clínica';
    end if;
  end if;

  select organization_id into v_org_id from clinics where id = p_clinic_id;
  if v_org_id is null then
    return jsonb_build_object('success', false, 'error', 'clinica_sem_organizacao');
  end if;

  select api_token, status into v_token, v_status
  from whatsapp_instances where org_id = v_org_id;
  if v_token is null or btrim(v_token) = '' or v_status is distinct from 'connected' then
    return jsonb_build_object('success', false, 'error', 'org_whatsapp_desconectado');
  end if;

  select recipients into v_recipients from report_settings where clinic_id = p_clinic_id;
  if v_recipients is null or cardinality(v_recipients) = 0 then
    return jsonb_build_object('success', false, 'error', 'sem_destinatarios');
  end if;

  v_text := build_commercial_report(p_clinic_id, p_kind, p_entry_from, p_entry_to,
                                    p_agenda_from, p_agenda_to, p_conv_from, p_conv_to, true);

  if v_text is null or btrim(v_text) = '' then
    perform log_system_error('report_send','empty_report',
      'Relatorio gerado vazio/nulo — envio abortado', 'error',
      p_clinic_id, jsonb_build_object('kind', p_kind), false);
    return jsonb_build_object('success', false, 'error', 'relatorio_vazio');
  end if;

  foreach v_num in array v_recipients loop
    v_norm := normalize_br_phone(v_num);
    continue when v_norm is null or length(v_norm) < 12;
    begin
      perform system_http_post(
        'https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
        jsonb_build_object('number', v_norm, 'text', v_text, 'delay', 0),
        8000
      );
      v_sent := v_sent + 1;
    exception when others then
      perform log_system_error('report_send','send_failed',
        'Falha ao enviar relatório pelo WhatsApp da organização', 'error',
        p_clinic_id, jsonb_build_object('recipient', v_norm, 'detail', sqlerrm), false);
    end;
  end loop;

  if v_sent = 0 then
    perform log_system_error('report_send','no_valid_recipient',
      'Relatório não enviado: nenhum destinatário válido (telefone < 12 dígitos?)', 'warning',
      p_clinic_id, jsonb_build_object('recipients', v_recipients), false);
    return jsonb_build_object('success', false, 'error', 'nenhum_destinatario_valido');
  end if;

  insert into report_sends (clinic_id, org_id, kind, trigger, recipients, period)
  values (p_clinic_id, v_org_id, p_kind, coalesce(p_trigger,'manual'), v_recipients,
          jsonb_build_object('entry_from', p_entry_from, 'entry_to', p_entry_to,
                             'agenda_from', p_agenda_from, 'agenda_to', p_agenda_to,
                             'conv_from', p_conv_from, 'conv_to', p_conv_to));

  return jsonb_build_object('success', true, 'sent', v_sent);
end;
$function$;
