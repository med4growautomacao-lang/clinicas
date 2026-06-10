-- Abre ticket automaticamente para leads de FORMULÁRIO.
--
-- Contexto: tickets nunca são criados pela tabela `leads` — eles nascem de:
--   1. fn_auto_open_ticket() quando entra mensagem em chat_messages (WhatsApp);
--   2. RPC create_lead_with_ticket() (lead criado pelo app);
--   3. (historicamente) o workflow n8n de forms, que criava o ticket por fora.
-- O fluxo de forms insere o lead direto em `leads`, SEM mensagem, então não
-- dispara (1). Quando o n8n parou de criar o ticket (meados de mai/2026), os
-- leads de forms passaram a entrar só na tabela (visíveis em Conversas) mas sem
-- ticket — sumindo do Kanban. 147 leads órfãos foram backfilled em 09/06/2026.
--
-- Correção de origem, no mesmo modelo do WhatsApp: o BANCO cria o ticket do
-- forms no insert do lead. Não duplica:
--   - só dispara para capture_channel = 'forms' (WhatsApp usa chat_messages,
--     app usa a RPC);
--   - checa se já existe ticket aberto antes de criar.
-- Mensagens posteriores reutilizam o ticket (fn_auto_open_ticket) e a primeira
-- resposta do lead move o ticket de 'forms' para 'whatsapp'
-- (fn_move_forms_to_whatsapp_on_inbound).

CREATE OR REPLACE FUNCTION fn_auto_open_ticket_forms()
RETURNS TRIGGER AS $$
DECLARE
  v_stage_id UUID;
BEGIN
  -- Só leads de formulário entram aqui
  IF NEW.capture_channel IS DISTINCT FROM 'forms' THEN
    RETURN NEW;
  END IF;

  -- Já tem ticket aberto? não cria outro
  IF EXISTS (SELECT 1 FROM tickets WHERE lead_id = NEW.id AND status = 'open') THEN
    RETURN NEW;
  END IF;

  -- Etapa de entrada do forms: 'forms' se existir, senão 'sincronizacao',
  -- senão a primeira do funil (menor position).
  SELECT id INTO v_stage_id FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'forms'
  ORDER BY position LIMIT 1;

  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id AND slug = 'sincronizacao'
    ORDER BY position LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id
    ORDER BY position LIMIT 1;
  END IF;

  -- Clínica sem funil configurado: não força ticket
  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, NEW.id, v_stage_id, 'open', NOW());

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- AFTER INSERT: precisa de NEW.id já materializado para criar o ticket.
CREATE TRIGGER trg_auto_open_ticket_forms
  AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION fn_auto_open_ticket_forms();
