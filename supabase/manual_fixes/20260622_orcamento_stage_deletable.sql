-- 22/06/2026 — Etapa "Orçamento Enviado" (slug='orcamento') excluível + limpeza
--
-- Contexto:
--   - O seed de clínicas novas (seed_default_funnel_stages) JÁ cria a etapa
--     "Orçamento Enviado" como is_system=false (excluível). O problema era só nas
--     clínicas ANTIGAS, onde ela ficou is_system=true (bloqueada na UI, que só
--     mostra excluir/editar quando !is_system).
--   - Pedido: tornar a etapa de orçamento excluível e removê-la das clínicas onde
--     ela está vazia (sem nenhum ticket parado nela).
--
-- Notas de FK (estado em produção):
--   tickets.stage_id            -> NO ACTION (impede excluir etapa com tickets)
--   leads.stage_id              -> SET NULL
--   lead_stage_history.old/new  -> SET NULL  (histórico perde a referência)
--   stage_transition_rules.tgt  -> CASCADE   (regras que apontavam p/ a etapa somem)
--
-- Resultado da execução (idempotente):
--   - 27 clínicas tinham a etapa; flag is_system zerada em todas as remanescentes.
--   - 23 clínicas com a etapa VAZIA -> etapa excluída.
--   - 4 clínicas mantêm a etapa por terem tickets nela (Bless Joias, Personalite
--     Viagens, Clínica Demo Med4Grow, Metaltres); agora is_system=false (excluíveis
--     pela UI assim que esvaziadas).
--   - Colateral: ~22 linhas de lead_stage_history viraram null; 2 regras de
--     automação removidas; 0 leads afetados.

-- Passo 1: torna a etapa excluível nas clínicas antigas (alinha com o seed atual).
UPDATE public.funnel_stages
   SET is_system = false
 WHERE slug = 'orcamento'
   AND is_system = true;

-- Passo 2: exclui a etapa apenas onde está vazia (0 tickets). O NOT EXISTS garante
-- que nenhuma etapa com ticket seja removida, mesmo em concorrência.
DELETE FROM public.funnel_stages fs
 WHERE fs.slug = 'orcamento'
   AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.stage_id = fs.id);
