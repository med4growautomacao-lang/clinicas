-- Imagens do Roteiro (a foto que acompanha a pergunta).
--
-- ⚠️ Bucket PÚBLICO para leitura, de propósito: a uazapi BUSCA a URL pela internet para montar o
-- `imageButton` e o `/send/media`. Link assinado com validade não serve, porque a mensagem pode
-- sair da fila depois do vencimento e a foto chegaria quebrada, em silêncio.
-- São fotos de produto (tela, arame), não dado de paciente.
--
-- Escrita escopada por clínica pela PRIMEIRA PASTA do caminho ({clinic_id}/arquivo.jpg), no mesmo
-- padrão do bucket payment-qr, com a mesma função `can_access_clinic_media_text`. Escrito
-- explicitamente e não "reaproveitado": a RLS de storage aqui não é lugar de DRY.
--
-- Teto de 5 MB e só imagem: o WhatsApp não entrega foto grande, e sem o teto a primeira falha
-- apareceria como "a foto não chega", que é o pior jeito de descobrir.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chatbot', 'chatbot', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chatbot_media_read   on storage.objects;
drop policy if exists chatbot_media_insert on storage.objects;
drop policy if exists chatbot_media_update on storage.objects;
drop policy if exists chatbot_media_delete on storage.objects;

-- Leitura aberta: é o que permite a uazapi baixar a foto para mandar ao contato.
create policy chatbot_media_read on storage.objects for select
  using (bucket_id = 'chatbot');

create policy chatbot_media_insert on storage.objects for insert
  with check (bucket_id = 'chatbot'
              and public.can_access_clinic_media_text((storage.foldername(name))[1]));

create policy chatbot_media_update on storage.objects for update
  using (bucket_id = 'chatbot'
         and public.can_access_clinic_media_text((storage.foldername(name))[1]))
  with check (bucket_id = 'chatbot'
              and public.can_access_clinic_media_text((storage.foldername(name))[1]));

create policy chatbot_media_delete on storage.objects for delete
  using (bucket_id = 'chatbot'
         and public.can_access_clinic_media_text((storage.foldername(name))[1]));
