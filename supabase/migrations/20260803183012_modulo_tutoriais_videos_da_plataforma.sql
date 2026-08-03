-- Módulo Tutoriais: vídeos que ensinam a usar a plataforma.
--
-- O conteúdo é GLOBAL, não por clínica: quem publica é o Super Admin e quem
-- assiste é qualquer usuário logado, das duas marcas (MedDesk e WakeDesk).
-- Por isso a tabela não tem clinic_id e a RLS não usa my_clinic_ids().

create table if not exists public.tutorials (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  -- URL de reprodução. Vídeo enviado -> URL pública do bucket 'tutorials';
  -- vídeo externo (YouTube/Vimeo/Loom) -> a própria URL colada no formulário.
  video_url     text not null,
  -- Caminho dentro do bucket. NULO quando o vídeo é link externo: é isso que
  -- diz se existe arquivo para apagar junto com a linha.
  storage_path  text,
  position      integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tutorials is
  'Vídeos de tutorial da plataforma. Global (sem clinic_id): publica o Super Admin, assiste qualquer usuário logado.';

-- Ordem da lista. created_at desempata posição repetida, senão a ordem oscila
-- entre um carregamento e outro.
create index if not exists idx_tutorials_ordem
  on public.tutorials (position, created_at);

create or replace function public.fn_tutorials_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tutorials_touch_updated_at on public.tutorials;
create trigger trg_tutorials_touch_updated_at
  before update on public.tutorials
  for each row execute function public.fn_tutorials_touch_updated_at();

alter table public.tutorials enable row level security;

-- Leitura: todo usuário logado vê os ATIVOS. O Super Admin vê também os
-- desativados (rascunho), senão ele publicaria às cegas.
drop policy if exists tutorials_select on public.tutorials;
create policy tutorials_select on public.tutorials
  for select to authenticated
  using (is_active or (select public.is_super_admin()));

-- Escrita: só Super Admin.
drop policy if exists tutorials_write on public.tutorials;
create policy tutorials_write on public.tutorials
  for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

revoke all on table public.tutorials from public, anon;
grant select, insert, update, delete on table public.tutorials to authenticated;

-- ── Bucket dos arquivos ────────────────────────────────────────────────────
-- Público na leitura (vídeo de ajuda não tem PII e assim o <video> toca sem
-- assinar URL). O teto de 50 MB é o limite GLOBAL do projeto: declarado aqui
-- para o erro ser previsível e a tela avisar antes de subir o arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutorials', 'tutorials', true, 52428800, array['video/*'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tutorials_media_read on storage.objects;
create policy tutorials_media_read on storage.objects
  for select to public
  using (bucket_id = 'tutorials');

drop policy if exists tutorials_media_insert on storage.objects;
create policy tutorials_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tutorials' and (select public.is_super_admin()));

drop policy if exists tutorials_media_update on storage.objects;
create policy tutorials_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'tutorials' and (select public.is_super_admin()))
  with check (bucket_id = 'tutorials' and (select public.is_super_admin()));

drop policy if exists tutorials_media_delete on storage.objects;
create policy tutorials_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'tutorials' and (select public.is_super_admin()));
