-- 20260706234110_quotes_storage_bucket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

INSERT INTO storage.buckets (id, name, public)
VALUES ('quotes', 'quotes', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "quotes_authenticated_insert" ON storage.objects;
CREATE POLICY "quotes_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quotes');
