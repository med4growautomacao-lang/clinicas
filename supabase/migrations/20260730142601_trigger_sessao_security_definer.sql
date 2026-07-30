-- O trigger da chave de memoria vira SECURITY DEFINER.
--
-- REGRESSAO INTRODUZIDA HOJE (30/07, ~1h de vida) e reproduzida antes deste conserto: a migration
-- 20260730135308 revogou o EXECUTE de fn_chat_session_id de anon/authenticated, mas
-- fn_fill_chat_session_id (o trigger que a chama) rodava com o privilegio DE QUEM INSERE.
-- `authenticated` tem INSERT em chat_messages e a policy FOR ALL permite para membro da clinica,
-- entao qualquer insert do front nesse papel morria com:
--   ERROR 42501: permission denied for function fn_chat_session_id
-- Provado com set_config('request.jwt.claims', ...) + set local role authenticated: o insert
-- falhou. Nenhuma tela insere direto HOJE (grep no src/ devolve zero), por isso nada quebrou em
-- producao, mas o caminho e permitido pela RLS e a primeira feature que gravar mensagem pelo
-- client ia estrear quebrada.
--
-- SECURITY DEFINER e o padrao da casa para trigger de chat_messages que le alem da linha
-- (fn_handoff_on_human_reply ja e). O definer executa fn_chat_session_id como owner, entao a
-- funcao da chave continua fechada para anon/authenticated (nao exposta via /rpc) sem quebrar
-- nenhum papel que insira na conversa.
create or replace function public.fn_fill_chat_session_id()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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
$function$;

-- create or replace preserva ACL; garante o fechamento nos dois caminhos de novo, por clareza.
revoke all on function public.fn_fill_chat_session_id() from public, anon, authenticated;
