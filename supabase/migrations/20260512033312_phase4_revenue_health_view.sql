-- 20260512033312_phase4_revenue_health_view
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE VIEW public.vw_revenue_health AS
WITH suspicious_amounts AS (
  SELECT clinic_id, COUNT(*) as count_suspeitos, SUM(amount) as soma
  FROM financial_transactions
  WHERE (amount > 0 AND amount < 10)
     OR amount > 1000000
  GROUP BY clinic_id
),
orphan_conversions AS (
  SELECT clinic_id, COUNT(*) as count_orfas
  FROM conversions
  WHERE financial_transaction_id IS NULL
  GROUP BY clinic_id
),
duplicate_conversions AS (
  SELECT clinic_id, COUNT(*) - COUNT(DISTINCT (lead_id, value, converted_at::date)) as count_duplicadas
  FROM conversions
  GROUP BY clinic_id
  HAVING COUNT(*) <> COUNT(DISTINCT (lead_id, value, converted_at::date))
),
pending_transactions AS (
  SELECT clinic_id, COUNT(*) as count_pendentes, SUM(amount) as valor_pendente
  FROM financial_transactions
  WHERE type = 'receita' AND status = 'pendente'
  GROUP BY clinic_id
)
SELECT 
  c.id as clinic_id,
  c.name as clinic_name,
  COALESCE(sa.count_suspeitos, 0) as valores_suspeitos,
  COALESCE(sa.soma, 0) as soma_suspeitos,
  COALESCE(oc.count_orfas, 0) as conversoes_orfas,
  COALESCE(dc.count_duplicadas, 0) as conversoes_duplicadas,
  COALESCE(pt.count_pendentes, 0) as transacoes_pendentes,
  COALESCE(pt.valor_pendente, 0) as valor_pendente,
  (COALESCE(sa.count_suspeitos, 0) +
   COALESCE(oc.count_orfas, 0) +
   COALESCE(dc.count_duplicadas, 0)) as total_inconsistencias
FROM clinics c
LEFT JOIN suspicious_amounts sa ON sa.clinic_id = c.id
LEFT JOIN orphan_conversions oc ON oc.clinic_id = c.id
LEFT JOIN duplicate_conversions dc ON dc.clinic_id = c.id
LEFT JOIN pending_transactions pt ON pt.clinic_id = c.id
WHERE (sa.count_suspeitos > 0 OR oc.count_orfas > 0 OR dc.count_duplicadas > 0 OR pt.count_pendentes > 0);

GRANT SELECT ON public.vw_revenue_health TO anon, authenticated, service_role;
