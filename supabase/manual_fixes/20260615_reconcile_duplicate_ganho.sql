-- Reconciliacao one-off dos leads com 2 tickets 'ganho' (double-count) gerados pela
-- reciclagem em registro retroativo. RODAR DEPOIS da migration 20260615000001 (Part 1),
-- senao fechar o ticket religaria a IA.
--
-- Regra: manter como venda o ticket que TEM a consulta (realizado/compareceu); neutralizar
-- o ganho-fantasma (sem consulta) movendo o stage -> fn_enforce_ticket_resolution_consistency
-- zera o outcome sozinho. NUNCA DELETE (dispara fn_cascade_delete_ticket_ganho, que apaga
-- conversoes/receitas).
--
-- So os casos CLAROS (exatamente 1 ticket com consulta e o outro sem). Ambiguos ficam de fora:
--   Rs cafe 97256bc6 (ambos sem consulta) e Vaz bd8ade5e (ambos com consulta) -> revisao manual.

BEGIN;

-- ============ JESSICA — Lorena (lead 4d4bbdae) ============
-- Mantem o ticket 2 (fae7840e, tem a consulta 09/06) como a venda; resolve o "aberto+ganho".
-- Part 1 ja garante que fechar um ticket 'ganho' nao religa a IA.
UPDATE tickets SET status='closed', closed_at=now()
WHERE id='fae7840e-0a2f-4191-a6f0-415bb1bcd46c' AND status='open';

-- Neutraliza o ticket fantasma 1 (30ec1ea2, sem consulta/sem conversao): mover o stage
-- para 'whatsapp' faz o trigger setar outcome=NULL. Continua 'closed'; nao dispara fn_activate
-- (nao ha transicao open->closed).
UPDATE tickets t
SET stage_id = (SELECT id FROM funnel_stages WHERE clinic_id=t.clinic_id AND slug='whatsapp' LIMIT 1)
WHERE t.id='30ec1ea2-9345-4288-8bee-6dcd712da7cb';

-- Garante IA pausada para o lead (cinto e suspensorio).
UPDATE leads SET ai_enabled=false, handoff_triggered_at=COALESCE(handoff_triggered_at, now())
WHERE id='4d4bbdae-9b2a-4432-853c-9cb1eba32c94';

-- ============ Clinica Vaz (lead 530d91f6) — caso claro ============
-- Mantem o ticket 1a00d721 (closed, consulta 05-04 realizado) como a venda.
-- Neutraliza o ticket fantasma 47644e74 (open, sem consulta): move o stage -> outcome=NULL.
-- (Vaz nao usa IA; fica como ticket aberto sem desfecho, equivalente a um lead ativo.)
UPDATE tickets t
SET stage_id = (SELECT id FROM funnel_stages WHERE clinic_id=t.clinic_id AND slug='whatsapp' LIMIT 1)
WHERE t.id='47644e74-097e-4c9d-b179-1fe68ae18426';

COMMIT;

-- Conferencia pos-reconciliacao: cada lead deve ter no maximo 1 ticket 'ganho'.
-- SELECT lead_id, count(*) FROM tickets WHERE outcome='ganho'
--   AND lead_id IN ('4d4bbdae-9b2a-4432-853c-9cb1eba32c94','530d91f6-bc0d-4216-b0f5-e93f26fa9113')
-- GROUP BY lead_id;
