-- Bucket publico para os documentos de orcamento (imagem/PDF) gerados no Kanban e
-- enviados por WhatsApp (uazapi busca a URL publica). Upload feito pelo frontend
-- (usuario autenticado); leitura publica (o arquivo e enviado ao cliente de qualquer forma).

INSERT INTO storage.buckets (id, name, public)
VALUES ('quotes', 'quotes', true)
ON CONFLICT (id) DO NOTHING;

-- Usuarios autenticados podem subir arquivos no bucket 'quotes'.
DROP POLICY IF EXISTS "quotes_authenticated_insert" ON storage.objects;
CREATE POLICY "quotes_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quotes');
