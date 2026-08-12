-- 20260707151049_product_quote_image_ids
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Seleção de fotos (banco de fotos do orçamento) lembrada POR PRODUTO.
-- null  = produto nunca teve orçamento enviado (usa o padrão global send_by_default);
-- {}    = configurado para não enviar nenhuma foto;
-- {ids} = fotos escolhidas no último envio daquele produto.
ALTER TABLE products ADD COLUMN IF NOT EXISTS quote_image_ids uuid[] DEFAULT NULL;
COMMENT ON COLUMN products.quote_image_ids IS 'Últimas fotos (quote_images.id) enviadas junto no orçamento deste produto; null = nunca configurado (usa send_by_default global).';
