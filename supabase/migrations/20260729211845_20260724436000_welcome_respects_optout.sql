-- 20260729211845_20260724436000_welcome_respects_optout
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Boas-vindas passa a respeitar o opt-out por tipo (antes NÃO havia como impedir boas-vindas para um
-- contato específico: é o único motor que nunca olhou leads.followup_enabled).
-- ⚠️ DE PROPÓSITO NÃO adicionamos o gate mestre `l.followup_enabled` aqui: 9.743 leads estão com essa
-- chave desligada e passariam a não receber boas-vindas de uma vez, em 26 clínicas (decisão do dono).
-- A tabela nasce vazia, então esta mudança é neutra hoje.
CREATE OR REPLACE FUNCTION public.fn_followup_candidates_welcome(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinic_id uuid, lead_id uuid, nome text, telefone text, clinic_phone text, message_text text, eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    l.clinic_id, l.id, l.name, l.phone,
    ac.phone, ac.welcome_message_text,
    (l.created_at + (coalesce(ac.welcome_message_delay, 5) || ' minutes')::interval)::timestamp,
    coalesce(ac.welcome_message_enabled, false),
    ss.send_token is not null,
    coalesce(ac.welcome_window_start, 6), coalesce(ac.welcome_window_end, 22)
  from leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = l.clinic_id
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.capture_channel = 'forms'
    and l.welcome_sent = false
    and coalesce(l.is_not_lead, false) = false
    -- opt-out por tipo (lead_followup_optout)
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'welcome')
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from chat_messages cm where cm.lead_id = l.id)
    and l.created_at >= ((now() at time zone 'America/Sao_Paulo') - interval '3 days')
$function$;
