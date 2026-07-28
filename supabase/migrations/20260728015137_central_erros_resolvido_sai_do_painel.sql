-- REGRA DO DONO (27/07): erro resolvido SAI do painel. A Central mostra o que esta aberto e nada
-- mais. Nao ha aba de resolvidos, nao ha contador de resolvidos.
--
-- "Sair do painel" aqui e remocao mesmo, nao filtro de tela: a linha e movida para
-- system_errors_archive e apagada de system_errors. Duas razoes para arquivar em vez de dropar:
--   1. a Central e o unico olho que temos (nao ha Sentry); apagar sem copia perderia a unica
--      trilha de que o problema existiu;
--   2. o fingerprint volta a ficar livre, entao um problema que reincide nasce como episodio
--      novo, com first_seen_at e contador proprios. Para monitor isso e o comportamento certo:
--      a condicao deixou de existir e voltou, nao e a mesma ocorrencia arrastada.
--
-- A invariante mora no TRIGGER, nao na tela: resolver pelo painel, pelo cron de monitores ou por
-- SQL na mao tem todos o mesmo desfecho.

create table if not exists public.system_errors_archive (
  like public.system_errors including defaults,
  archived_at timestamptz not null default now()
);

comment on table public.system_errors_archive is
  'Historico da Central de Erros. Recebe a linha quando ela e resolvida (trigger trg_system_error_arquiva_resolvido). Fora do painel de propósito.';

create index if not exists idx_system_errors_archive_arquivado
  on public.system_errors_archive (archived_at desc);
create index if not exists idx_system_errors_archive_fingerprint
  on public.system_errors_archive (fingerprint, archived_at desc);

alter table public.system_errors_archive enable row level security;

drop policy if exists system_errors_archive_super_admin_all on public.system_errors_archive;
create policy system_errors_archive_super_admin_all
  on public.system_errors_archive for all
  using (is_super_admin()) with check (is_super_admin());

-- Default-deny explicito: o default ACL do schema ja concedeu CRUD a anon/authenticated em tabela
-- nova antes (furo de 27/07). Aqui o acesso e so do backend e do super admin via RLS.
revoke all on table public.system_errors_archive from anon, authenticated;
grant select, insert, update, delete on table public.system_errors_archive to service_role;

create or replace function public.fn_system_error_arquiva_resolvido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.system_errors_archive (
    id, fingerprint, scope, code, level, title, clinic_id, is_monitor, occurrences,
    first_seen_at, last_seen_at, status, resolved_at, last_context
  ) values (
    new.id, new.fingerprint, new.scope, new.code, new.level, new.title, new.clinic_id,
    new.is_monitor, new.occurrences, new.first_seen_at, new.last_seen_at,
    'resolved', coalesce(new.resolved_at, now()), new.last_context
  )
  on conflict do nothing;

  delete from public.system_errors where id = new.id;
  return null;
end $function$;

drop trigger if exists trg_system_error_arquiva_resolvido on public.system_errors;
create trigger trg_system_error_arquiva_resolvido
  after update of status on public.system_errors
  for each row when (new.status = 'resolved')
  execute function public.fn_system_error_arquiva_resolvido();

-- Limpa o passivo: os 39 ja resolvidos saem do painel agora, com copia no arquivo.
insert into public.system_errors_archive (
  id, fingerprint, scope, code, level, title, clinic_id, is_monitor, occurrences,
  first_seen_at, last_seen_at, status, resolved_at, last_context
)
select id, fingerprint, scope, code, level, title, clinic_id, is_monitor, occurrences,
       first_seen_at, last_seen_at, 'resolved', coalesce(resolved_at, now()), last_context
  from public.system_errors where status = 'resolved'
on conflict do nothing;

delete from public.system_errors where status = 'resolved';

revoke all on function public.fn_system_error_arquiva_resolvido() from public, anon, authenticated;
