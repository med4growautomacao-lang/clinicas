-- O alerta vermelho do onboarding só enxergava os contatos vindos da IMPORTAÇÃO (ticket aberto na
-- etapa Sincronização). Quem já estava no funil (o "Tipo C" da fila) não gera esse ticket, então
-- liberar o Comercial no meio da organização deixava a pendência INVISÍVEL: sem pílula, sem card
-- piscando e sem modal. Medido na Lorena: 123 contatos na fila e nenhum sinal na tela.
--
-- Agora devolve `pending_total` = a fila de verdade, mas SÓ para clínica com rodada EM CURSO
-- (período definido pelo "Refazer" OU alguém já auditou algo). Sem esse recorte, toda clínica antiga
-- ganharia um alerta gigante de um trabalho que ninguém pediu (Gheller ~3 mil, Metaltres ~3,5 mil).
-- E a contagem da fila é a parte CARA (medido: 176 ms na Lorena), então fica atrás de uma guarda
-- barata com EXISTS e não roda para quem não está organizando.
--
-- Nota de arqueologia: duas migrações aplicadas minutos antes desta criaram e removeram
-- `onboarding_reopen(uuid)` (versions 20260729222849 e 20260729222954). Elas se anulam e não têm
-- arquivo de propósito: a RPC virou desnecessária porque o botão "Organizar contatos" reabre o modal
-- por estado local do componente, sem passar pelo gate — e limpar onboarding_completed_at seria pior,
-- faria o modal voltar a abrir sozinho para TODOS os usuários da clínica, não só para quem clicou.
CREATE OR REPLACE FUNCTION public.onboarding_gate_status(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_connected boolean; v_completed boolean; v_pending int; v_stage uuid;
  v_period integer; v_em_curso boolean; v_pending_total int := NULL;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('should_onboard', false, 'pending', 0); END IF;

  v_connected := EXISTS (SELECT 1 FROM whatsapp_instances WHERE clinic_id = p_clinic_id AND status = 'connected');
  SELECT onboarding_completed_at IS NOT NULL, onboarding_period_months
    INTO v_completed, v_period FROM clinics WHERE id = p_clinic_id;

  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  v_pending := coalesce((SELECT count(*) FROM tickets
                          WHERE clinic_id = p_clinic_id AND stage_id = v_stage AND status = 'open'), 0);

  -- Guarda BARATA (EXISTS, para na 1ª linha) antes de pagar pela contagem da fila.
  v_em_curso := v_period IS NOT NULL
                OR EXISTS (SELECT 1 FROM leads
                            WHERE clinic_id = p_clinic_id AND onboarding_reviewed_at IS NOT NULL);

  IF v_em_curso THEN
    SELECT count(*) INTO v_pending_total FROM onboarding_pending_leads(p_clinic_id);
  END IF;

  RETURN jsonb_build_object(
    'should_onboard', (v_connected AND NOT coalesce(v_completed, false)),
    'pending', v_pending,               -- só os importados (os que piscam vermelho no Kanban)
    'pending_total', v_pending_total,   -- a fila inteira; null = clínica sem rodada em curso
    'em_curso', v_em_curso,
    'connected', v_connected, 'completed', coalesce(v_completed, false));
END; $function$;
