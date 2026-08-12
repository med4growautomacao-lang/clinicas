-- 20260811042402_20260811010500_restaura_security_invoker_das_views_kpi
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 🚨 VAZAMENTO: v_kpi_outcomes ficou legível SEM LOGIN, com as 20 clínicas de uma vez.
--
-- Causa: a migration 20260810202548 recriou a view com `create or replace view` para acrescentar
-- a coluna loss_reason_slug, e NÃO repetiu a cláusula `with (security_invoker = on)`.
-- ⚠️ `create or replace view` sem `with` ZERA as reloptions (AT_ReplaceRelOptions). Sem
-- security_invoker a view volta a rodar como o dono (postgres, que tem BYPASSRLS), a RLS de
-- tickets/leads deixa de valer, e qualquer portador da chave pública `anon` (que vai no bundle do
-- front) lê tudo: ganho/perda por dia, motivo, canal, plataforma de anúncio, lead_id e ticket_id.
--
-- Medido antes do conserto, com `set local role anon`:
--   v_kpi_outcomes  -> 8.194 linhas, 20 clínicas   ← este commit
--   v_kpi_scheduled -> 2.139 linhas, 16 clínicas   ← pré-existente, mesma causa (20260729150616)
--   v_kpi_leads / v_kpi_wins -> 0 (as irmãs mantiveram a cláusula)
--
-- 📌 REGRA: `alter view ... set (security_invoker = on)` em vez de confiar no `create or replace`.
-- Um ALTER separado sobrevive a qualquer reescrita futura da view feita por outra sessão, que é
-- exatamente como este furo nasceu.

alter view public.v_kpi_outcomes  set (security_invoker = on);

-- Mesmo defeito, mesma linha de conserto. Não é deste commit (veio de 29/07), mas é vazamento
-- vivo e corrigi-lo aqui custa uma linha; deixar para depois seria escolher manter aberto.
alter view public.v_kpi_scheduled set (security_invoker = on);
