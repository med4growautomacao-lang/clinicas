-- Respostas rápidas do chat humano: atalho "/" na caixa de envio (ChatComposer), uma lista por clínica.
-- Não alimenta o agente de IA nem os follow-ups: é só texto pronto para o operador colar, revisar e enviar.

create table if not exists public.quick_replies (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  shortcut    text not null,
  content     text not null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- O atalho é a palavra digitada depois da barra: uma palavra só, até 40 caracteres.
  constraint quick_replies_shortcut_chk check (char_length(shortcut) between 1 and 40 and shortcut !~ '\s'),
  -- 4096 = MAX_TEXT da edge chat-send: acima disso o envio é recusado (texto_muito_longo).
  constraint quick_replies_content_chk check (char_length(content) between 1 and 4096)
);

comment on table public.quick_replies is
  'Respostas rápidas do chat humano (atalho "/" no ChatComposer), uma lista por clínica. Não entra no agente de IA.';
comment on column public.quick_replies.shortcut is
  'Palavra-atalho digitada depois da barra. Única por clínica, sem distinguir maiúsculas (índice em lower()).';

-- Atalho único por clínica, sem distinguir maiúsculas. clinic_id na frente: serve também de índice da listagem.
create unique index if not exists uq_quick_replies_clinic_shortcut
  on public.quick_replies (clinic_id, lower(shortcut));

-- updated_at: mesmo padrão das irmãs (fn_tutorials_touch_updated_at). NÃO usar handle_updated_at,
-- que grava `now() at time zone 'America/Sao_Paulo'` (timestamp SEM tz) e, numa coluna timestamptz,
-- deslocaria 3h (CLAUDE.md §3, mistura de tipos).
create or replace function public.fn_quick_replies_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_quick_replies_touch_updated_at on public.quick_replies;
create trigger trg_quick_replies_touch_updated_at
  before update on public.quick_replies
  for each row execute function public.fn_quick_replies_touch_updated_at();

-- RLS no padrão set-based (my_clinic_ids() SEM argumento, CLAUDE.md §2). Qualquer membro da clínica
-- cria e edita: quem usa o chat é a secretária e o vendedor, não só o admin. O braço do super-admin
-- cobre o suporte.
alter table public.quick_replies enable row level security;
drop policy if exists quick_replies_access on public.quick_replies;
create policy quick_replies_access on public.quick_replies
  for all to authenticated
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

revoke all on public.quick_replies from public, anon;
grant select, insert, update, delete on public.quick_replies to authenticated;
grant all on public.quick_replies to service_role;
