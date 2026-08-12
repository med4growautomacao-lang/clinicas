-- 20260729015656_check_vocabulario_capture_channel
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fecha o vocabulario de public.leads.capture_channel: whatsapp | forms | manual | balcao.
--
-- Estado dos dados conferido imediatamente antes desta migration (32.690 leads):
--   nulos = 0, vazios = 0, fora do vocabulario = 0, com espaco sobrando = 0.
--
-- PASSO 1: desarmar apply_link_session_to_lead. NAO e cosmetico, e pre-requisito.
-- A trigger trg_apply_link_session (ATIVA, AFTER INSERT em chat_messages) faz
--   capture_channel = COALESCE(capture_channel, v_session.utm_medium)
-- e link_sessions.utm_medium hoje so contem 'bio' e 'link', os dois FORA do vocabulario.
-- Como e trigger AFTER de chat_messages, violar o CHECK ali nao e erro isolado: aborta o
-- INSERT da mensagem, ou seja, a mensagem do paciente nao e gravada.
-- utm_medium e meio de MARKETING, nunca canal de captacao: erro de categoria, com ou sem CHECK.

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'apply_link_session_to_lead';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'apply_link_session_to_lead nao existe mais no banco. Outra sessao mexeu nesta area: releia o estado atual antes de aplicar esta migration.';
  END IF;

  IF position('COALESCE(capture_channel, v_session.utm_medium)' in v_src) = 0
     AND position('CANAL-NAO-VEM-DE-UTM' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_link_session_to_lead foi alterada por outra sessao: nao tem nem a linha antiga nem a marca desta migration. Refaca o passo 1 em cima da versao atual da funcao.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.apply_link_session_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_content   text;
  v_protocolo text;
  v_session   link_sessions%ROWTYPE;
BEGIN
  IF NEW.direction <> 'inbound' THEN RETURN NEW; END IF;

  v_content := NEW.message->>'content';
  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- ATENCAO: esta regex exige EXATAMENTE 4 digitos, e a edge whatsapp-redirect gera protocolo
  -- de 6 digitos desde 13/07. Quem aplica a sessao de link ao lead hoje e a trigger irma
  -- trg_close_redirect_protocol, cuja regex aceita qualquer quantidade de digitos.
  -- Mantida como esta de proposito: mexer na regex e outra mudanca, com outro risco.
  v_protocolo := substring(v_content FROM '\[Protocolo ([0-9]{4}) não apague essa mensagem\]');
  IF v_protocolo IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_session
  FROM link_sessions
  WHERE protocolo = v_protocolo
    AND expires_at > now()
    AND used_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.lead_id IS NOT NULL THEN
    -- CANAL-NAO-VEM-DE-UTM: a atribuicao de capture_channel foi REMOVIDA daqui de proposito.
    -- utm_medium e meio de marketing ('bio', 'link', 'cpc'), nunca canal de captacao. O canal
    -- ja nasce correto do caminho de criacao do lead e nao pode ser sobrescrito por parametro
    -- de campanha: alem de sujar o dado, quebraria o CHECK leads_capture_channel_check dentro
    -- de uma trigger AFTER de chat_messages, abortando o INSERT da mensagem do paciente.
    UPDATE leads SET
      rast_id         = v_session.rast_id,
      source          = COALESCE(source, v_session.utm_source),
      g_source_name   = COALESCE(g_source_name, v_session.utm_source),
      g_campaign_name = COALESCE(g_campaign_name, v_session.utm_campaign)
    WHERE id = NEW.lead_id;

    UPDATE link_sessions SET used_at = now() WHERE protocolo = v_protocolo;
  END IF;

  RETURN NEW;
END;
$function$;

-- PASSO 2: o CHECK.
-- lock_timeout: leads e tabela quente. ADD CONSTRAINT pega ACCESS EXCLUSIVE; melhor falhar em
-- 5s e repetir fora do pico do que segurar a fila inteira.
SET lock_timeout = '5s';

-- NULL e ACEITO de proposito: a coluna e nullable e ha 0 nulos hoje. Tornar NOT NULL seria
-- outra mudanca de comportamento, com blast radius proprio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'leads'
      AND con.conname = 'leads_capture_channel_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_capture_channel_check
      CHECK (capture_channel IN ('whatsapp', 'forms', 'manual', 'balcao'))
      NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'leads'
      AND con.conname = 'leads_capture_channel_check'
      AND con.convalidated = false
  ) THEN
    ALTER TABLE public.leads VALIDATE CONSTRAINT leads_capture_channel_check;
  END IF;
END
$$;

RESET lock_timeout;

COMMENT ON CONSTRAINT leads_capture_channel_check ON public.leads IS
  'Vocabulario fechado do canal de captacao: whatsapp | forms | manual | balcao. Valor novo (crm, parceiro) quebraria as views v_kpi_*, as RPCs de painel e os chips das telas, porque um lado usa ELSE whatsapp e o outro filtra por igualdade. NULL e aceito porque a coluna e nullable. Desarmado junto: apply_link_session_to_lead nao grava mais utm_medium nesta coluna.';
