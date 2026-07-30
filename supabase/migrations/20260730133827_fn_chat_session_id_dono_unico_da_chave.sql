-- DONO UNICO DA CHAVE DE MEMORIA, de verdade.
--
-- Depois do conserto de 30/07 sobraram DOIS lugares compondo a mesma string: `ingest_wa_message`
-- (que pega a instancia pelo api_token) e o trigger `fn_fill_chat_session_id` (que pega pelo
-- clinic_id, com `LIMIT 1` SEM `ORDER BY`, e usava os digitos CRUS do telefone em vez do
-- normalizado). Enquanto cada clinica tem 1 instancia isso da no mesmo, mas "dar no mesmo hoje"
-- nao e invariante: duas instancias com telefone na mesma clinica, ou um telefone fora do padrao,
-- e as duas composicoes divergem. A memoria parte em duas outra vez e o alerta de chave ausente
-- NAO acende, porque a chave chegou, so estava errada.
--
-- Agora existe UMA funcao e as duas chamam. Telefone e chave, e chave tem um dono so.
--
-- Diferenca de comportamento no trigger, de proposito: antes usava regexp_replace(phone) CRU,
-- agora normaliza. Isso ALINHA as linhas so-outbound (lembrete, encerramento, produtores de
-- welcome/reengajamento) com a chave que o caminho de entrada ja produz, porque ingest_wa_message
-- compoe a partir do chatid normalizado e nao de leads.phone. Medido: 33 leads de 33.055 tem
-- telefone fora do padrao, 3 ativos em 30 dias.

CREATE OR REPLACE FUNCTION public.fn_chat_session_id(p_clinic_id uuid, p_phone text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  -- ORDER BY deterministico: com o LIMIT 1 solto, duas instancias com telefone davam chaves
  -- diferentes conforme a ordem fisica das linhas. `connected` primeiro (e a que atende), depois
  -- o proprio numero como desempate estavel.
  select wi.phone_number || normalize_br_phone(p_phone)
    from public.whatsapp_instances wi
   where wi.clinic_id = p_clinic_id
     and coalesce(wi.phone_number, '') <> ''
     and normalize_br_phone(p_phone) is not null
   order by (wi.status = 'connected') desc nulls last, wi.phone_number
   limit 1;
$function$
;

revoke all on function public.fn_chat_session_id(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_chat_session_id(uuid, text) to service_role;

comment on function public.fn_chat_session_id(uuid, text) is
  'Chave de memoria do Agente IA: telefone da instancia da clinica + telefone do contato NORMALIZADO. Fonte unica: ingest_wa_message e o trigger fn_fill_chat_session_id chamam esta funcao. Nao montar essa string em outro lugar (foi o defeito de 17/07 a 30/07/2026).';

CREATE OR REPLACE FUNCTION public.fn_fill_chat_session_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clinic_id  uuid;
  v_lead_phone text;
  v_session    text;
BEGIN
  -- Chave explicita SEMPRE vence: e o que mantem o sandbox (sessao propria) funcionando.
  IF NEW.session_id IS NOT NULL AND NEW.session_id <> '' THEN
    RETURN NEW;
  END IF;

  v_clinic_id  := NEW.clinic_id;
  v_lead_phone := NEW.phone;

  IF NEW.lead_id IS NOT NULL THEN
    SELECT COALESCE(v_clinic_id, clinic_id),
           COALESCE(NULLIF(v_lead_phone, ''), phone)
      INTO v_clinic_id, v_lead_phone
      FROM public.leads
     WHERE id = NEW.lead_id;
  END IF;

  IF v_clinic_id IS NULL OR v_lead_phone IS NULL OR v_lead_phone = '' THEN
    RETURN NEW;
  END IF;

  v_session := public.fn_chat_session_id(v_clinic_id, v_lead_phone);
  IF v_session IS NOT NULL THEN
    NEW.session_id := v_session;
  END IF;

  RETURN NEW;
END;
$function$
;
