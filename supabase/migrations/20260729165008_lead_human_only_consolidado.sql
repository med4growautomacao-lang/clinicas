-- ============================================================================================
-- Cadeado "Atendimento pessoal" (leads.human_only) — consolidação
-- ============================================================================================
-- Aplicada via MCP em 29/07/2026 em 2 passos, sem gerar arquivo no repo — erro meu; este arquivo
-- repõe a história. Nome = versão real do 1º passo (20260729165008), logo é ignorada em produção.
--   20260724390000_lead_human_only_lock            -> version 20260729165008
--   20260724391000_onboarding_audit_human_only_param -> version 20260729165058 (vai no arquivo do
--     onboarding, junto do resto de onboarding_audit_apply)
--
-- CASO REAL: a dra faz relacionamento pessoal no MESMO WhatsApp da secretária IA. Antes só existia
-- "IA off por enquanto": ciclo novo zera o handoff e fechar ticket não-ganho religa ai_enabled, então
-- o paciente pessoal voltava para a IA sozinho.
-- ============================================================================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS human_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leads.human_only IS
  'Cadeado "Atendimento pessoal": IA e follow-up nunca assumem este contato. Forçado por trigger (trg_enforce_human_only), então NENHUM caminho religa sozinho.';

-- ⚠️ BLINDAGEM POR DESIGN, não é bug: qualquer caminho (fechar ticket, ciclo novo, onboarding, CRM,
-- caminho futuro) que tente ligar IA/follow-up com o cadeado fechado é anulado em silêncio. Não
-- "consertar" isso achando que é update perdido.
CREATE OR REPLACE FUNCTION public.fn_enforce_human_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.human_only THEN
    NEW.ai_enabled := false;
    NEW.followup_enabled := false;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_enforce_human_only ON public.leads;
CREATE TRIGGER trg_enforce_human_only
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_human_only();

-- Cinto e suspensório: o religador de "ticket resolvido" também respeita o cadeado (evita UPDATE
-- inútil por linha) e ganhou a guarda do import do onboarding.
CREATE OR REPLACE FUNCTION public.fn_activate_ai_on_ticket_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'closed'
     AND OLD.status IS DISTINCT FROM 'closed'
     AND NEW.lead_id IS NOT NULL
     AND NEW.outcome IS DISTINCT FROM 'ganho'
     AND coalesce(current_setting('app.onboarding_import', true), '') <> 'on' THEN
    UPDATE leads
      SET ai_enabled = true
      WHERE id = NEW.lead_id
        AND ai_enabled = false
        AND NOT human_only;
  END IF;
  RETURN NEW;
END; $function$;
