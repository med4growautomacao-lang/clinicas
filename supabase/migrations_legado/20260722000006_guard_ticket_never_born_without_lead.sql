-- Duas brechas que deixam nascer ticket sem lead. Nenhuma era a origem dos órfãos de 22/07
-- (essa era o cron delete_pending_leads, ver 20260722000005), mas ambas produzem o mesmo
-- estrago silencioso: ticket órfão some do Kanban e fica fora de todo painel.

-- (1) create_lead_with_ticket: o INSERT em leads pode ser SUPRIMIDO pelo trigger
-- fn_handle_lead_uniqueness, que faz RETURN NULL quando encontra lead equivalente (por rast_id
-- ou telefone >=12 díg). Nesse caso o RETURNING devolve NULL e o código seguia adiante inserindo
-- o ticket com lead_id NULL. O fallback só cobria telefone com 12+ dígitos: lead sem telefone,
-- ou com telefone curto, caía no buraco.
CREATE OR REPLACE FUNCTION public.create_lead_with_ticket(p_clinic_id uuid, p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_capture_channel text DEFAULT 'manual'::text, p_stage_id uuid DEFAULT NULL::uuid, p_estimated_value numeric DEFAULT NULL::numeric, p_avatar_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lead_id uuid; v_ticket_id uuid; v_stage_id uuid := p_stage_id; v_nphone text;
BEGIN
  v_nphone := normalize_br_phone(p_phone);
  IF v_stage_id IS NULL THEN SELECT id INTO v_stage_id FROM funnel_stages WHERE clinic_id=p_clinic_id ORDER BY position LIMIT 1; END IF;
  IF v_nphone IS NOT NULL AND length(v_nphone)>=12 THEN
    SELECT id INTO v_lead_id FROM leads WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone LIMIT 1;
  END IF;
  IF v_lead_id IS NULL THEN
    INSERT INTO leads (clinic_id, name, phone, email, source, capture_channel, estimated_value, avatar_url)
    VALUES (p_clinic_id, p_name, COALESCE(v_nphone, p_phone), p_email, p_source, p_capture_channel, p_estimated_value, p_avatar_url)
    RETURNING id INTO v_lead_id;

    -- INSERT suprimido pelo trigger de unicidade: recupera o lead que já existia.
    -- Agora tenta por QUALQUER telefone (não só >=12) e também por e-mail — antes o fallback
    -- exigia 12+ dígitos e devolvia NULL silenciosamente para todo o resto.
    IF v_lead_id IS NULL AND v_nphone IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM leads
      WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone LIMIT 1;
    END IF;
    IF v_lead_id IS NULL AND NULLIF(trim(p_email),'') IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM leads
      WHERE clinic_id=p_clinic_id AND lower(trim(email))=lower(trim(p_email)) LIMIT 1;
    END IF;
  END IF;

  -- TRAVA: sem lead não se abre ticket.
  IF v_lead_id IS NULL THEN
    PERFORM log_system_error(
      'kanban', 'LEAD_CREATE_SEM_ID',
      'create_lead_with_ticket não conseguiu resolver o lead — ticket NÃO foi aberto',
      'error', p_clinic_id,
      jsonb_build_object('nome', p_name, 'telefone', p_phone, 'email', p_email,
                         'phone_normalizado', v_nphone),
      false
    );
    RETURN jsonb_build_object('success', false, 'error_code', 'lead_nao_resolvido');
  END IF;

  SELECT id INTO v_ticket_id FROM tickets WHERE lead_id=v_lead_id AND status='open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at) VALUES (p_clinic_id, v_lead_id, v_stage_id, 'open', now()) RETURNING id INTO v_ticket_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'lead_id', v_lead_id, 'ticket_id', v_ticket_id, 'stage_id', v_stage_id);
END; $function$;

-- (2) fn_auto_move_lead_to_agendado: mesma falha do set_ticket_stage já corrigido em
-- 20260722000004 — ao abrir "novo ciclo" copiava v_ticket.lead_id do ticket de origem, então
-- ticket órfão gerava outro órfão a cada consulta criada.
CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
  v_new_ticket uuid;
BEGIN
  PERFORM set_config('app.stage_source', 'agenda', true);

  IF NEW.ticket_id IS NOT NULL THEN
    SELECT id, clinic_id, lead_id, stage_id, status, outcome INTO v_ticket
    FROM tickets WHERE id = NEW.ticket_id;
  ELSE
    SELECT t.id, t.clinic_id, t.lead_id, t.stage_id, t.status, t.outcome INTO v_ticket
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON normalize_br_phone(p.phone) = normalize_br_phone(l.phone) AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id AND t.status = 'open'
    LIMIT 1;
  END IF;
  IF v_ticket.id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_target_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  -- lead_id NULL: ticket órfão não abre ciclo novo (não se reproduz).
  IF v_ticket.outcome IS NOT NULL AND v_ticket.lead_id IS NOT NULL THEN
    UPDATE tickets SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = v_ticket.id AND status <> 'closed';

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_ticket.clinic_id, v_ticket.lead_id, v_target_stage_id, 'open', now())
    RETURNING id INTO v_new_ticket;

    UPDATE appointments SET ticket_id = v_new_ticket WHERE id = NEW.id;
  ELSE
    UPDATE tickets
      SET stage_id = v_target_stage_id
    WHERE id = v_ticket.id
      AND stage_id IS DISTINCT FROM v_target_stage_id;
  END IF;

  RETURN NEW;
END;
$function$;
