-- Rollback: remove a policy de upload do bucket 'quotes'.
-- O bucket em si NÃO é removido aqui (pode conter documentos já enviados);
-- para remover de vez: delete os objetos e depois `delete from storage.buckets where id='quotes';`
DROP POLICY IF EXISTS "quotes_authenticated_insert" ON storage.objects;
