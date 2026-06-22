-- 22/06/2026 — Backfill: 87 vendas da "Rent a Wish - Girl" marcadas como Ganho
--
-- Contexto / diagnóstico:
--   A clínica tem a regra de gatilho keywords='parabéns pela contratação' -> etapa
--   'ganho' (criada em 14/04). A mensagem é uma venda fechada inequívoca
--   ("Parabéns pela contratação! 🥰 O contrato segue em anexo.").
--   A automação (n8n) disparou de forma intermitente: 122 tickets receberam a
--   mensagem, mas 35 viraram 'ganho' e 87 ficaram travados (open, sem outcome),
--   parados em Contato via WhatsApp / Agendado / Sincronização. Nenhum desses 87
--   leads tinha a venda registrada em outro ticket -> ~70% das vendas da clínica
--   estavam fora do dashboard (Comercial/Marketing contam por tickets.outcome).
--   A Rent a Wish NÃO usa IA nem follow-up (confirmado pelo dono).
--
-- Caminho usado: RPC canônica finalize_ticket(p_ticket_id, 'ganho', p_resolve:=false).
--   - Marca outcome='ganho' + outcome_at + stage='ganho' (atômico).
--   - p_resolve=false => mantém o card aberto (status='open'), igual ao app.
--   - Triggers em tickets, no caso desta clínica:
--       * fn_log_ticket_stage_change      -> registra lead_stage_history (desejado).
--       * fn_enforce_ticket_resolution    -> mantém stage<->outcome consistente.
--       * fn_notify_encerramento_ganho    -> NÃO dispara (só clinic MedDesk 9d98d508).
--       * fn_activate_ai_on_ticket_resolved -> NÃO religa IA (só quando status->closed
--                                              e outcome<>ganho; aqui segue 'open').
--       * fn_sync_appointment_status...   -> não toca appointments (só compareceu/faltou).
--   - NÃO cria conversão financeira/receita (não temos o valor das vendas). Conta
--     como conversão sem receita — comportamento esperado para este backfill.
--
-- Resultado verificado: 87/87 outcome='ganho', stage='ganho', status='open',
--   lead_stage_history registrado, 0 leads com IA religada.
--
-- Backup do estado anterior (para reversão): tabela public._backfill_rentawish_ganho_20260622
--   (ticket_id, old_stage_id, old_outcome, old_outcome_at, old_status).
--
-- ============================ EXECUTADO ============================
-- (Reproduzido aqui para registro; já aplicado em produção em 22/06/2026.)

-- 1) Backup
CREATE TABLE IF NOT EXISTS public._backfill_rentawish_ganho_20260622 (
  ticket_id uuid PRIMARY KEY, old_stage_id uuid, old_outcome text,
  old_outcome_at timestamptz, old_status text, backed_up_at timestamptz DEFAULT now()
);
INSERT INTO public._backfill_rentawish_ganho_20260622 (ticket_id, old_stage_id, old_outcome, old_outcome_at, old_status)
SELECT t.id, t.stage_id, t.outcome, t.outcome_at, t.status
FROM tickets t
WHERE t.id IN (
  WITH a AS (
    SELECT r.clinic_id, r.keywords FROM stage_transition_rules r JOIN clinics c ON c.id=r.clinic_id
    WHERE c.name='Rent a Wish - Girl' AND r.keywords='parabéns pela contratação'
  )
  SELECT DISTINCT cm.ticket_id FROM a JOIN chat_messages cm
    ON cm.clinic_id=a.clinic_id AND cm.direction='outbound'
   AND (cm.message->>'content') ILIKE '%'||a.keywords||'%'
  WHERE cm.ticket_id IS NOT NULL
) AND t.outcome IS DISTINCT FROM 'ganho'
ON CONFLICT (ticket_id) DO NOTHING;

-- 2) Aplicação
DO $$
DECLARE r record; v_res jsonb; v_ok int := 0; v_fail int := 0;
BEGIN
  FOR r IN SELECT ticket_id FROM public._backfill_rentawish_ganho_20260622 LOOP
    v_res := public.finalize_ticket(r.ticket_id, 'ganho', NULL, NULL, false);
    IF COALESCE((v_res->>'success')::boolean, false) THEN v_ok := v_ok + 1;
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'FALHA ticket % -> %', r.ticket_id, v_res; END IF;
  END LOOP;
  RAISE NOTICE 'Backfill concluido: ok=% fail=%', v_ok, v_fail;
END $$;

-- ============================ REVERSÃO (se necessário) ============================
-- Restaura stage/outcome/status anteriores a partir do backup. Observação: as linhas
-- extras criadas em lead_stage_history (entrada para 'ganho' hoje) permaneceriam;
-- remover manualmente se preciso (where new_stage_id = <ganho> and changed_at::date='2026-06-22').
--
-- UPDATE tickets t SET stage_id=b.old_stage_id, outcome=b.old_outcome,
--        outcome_at=b.old_outcome_at, status=b.old_status
-- FROM public._backfill_rentawish_ganho_20260622 b
-- WHERE t.id=b.ticket_id;
