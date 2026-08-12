-- 20260508170312_add_orcamento_slug_to_funnel_stages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

UPDATE funnel_stages 
SET slug = 'orcamento', is_system = true 
WHERE name = 'Orçamento Enviado';
