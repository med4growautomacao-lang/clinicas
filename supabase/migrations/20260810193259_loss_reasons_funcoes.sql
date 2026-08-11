-- Funções do catálogo de motivo de perda.
--
-- Três funções, com públicos diferentes de propósito:
--   fn_resolve_loss_reason   -> tradutor puro texto->slug. Usado por finalize_ticket e pelo CRM.
--   fn_clinic_loss_reasons   -> lista da clínica. INTERNA (edge/backend com service_role).
--   get_clinic_loss_reasons  -> a mesma lista para o FRONT: wrapper com guard + _impl.
--
-- ⚠️ A coluna de saída chama `ordem`, não `position`: `position` é palavra reservada em
-- RETURNS TABLE (conflita com a função POSITION(x IN y)) e quebra a criação.

-- ------------------------------------------------------------------ tradutor

create or replace function public.fn_resolve_loss_reason(p_texto text)
returns text
language sql
stable
set search_path to 'public'
as $$
  -- Sem clinic_id de propósito: o de-para é global. Um parâmetro que não pode ser usado é pior
  -- que a ausência dele, porque sugere um isolamento por clínica que não existe.
  -- Sem match devolve NULL. NUNCA inventa slug: texto desconhecido tem que aparecer no monitor,
  -- não virar uma categoria errada em silêncio.
  select a.slug
  from public.loss_reason_aliases a
  where p_texto is not null
    and a.alias_norm = public.normalize_stage_text(p_texto)
  limit 1;
$$;

comment on function public.fn_resolve_loss_reason(text) is
  'Traduz texto livre de motivo de perda para o slug canônico. NULL = sem tradução (acende monitor).';

-- ------------------------------------------------------------------ lista da clínica (interna)

create or replace function public.fn_clinic_loss_reasons(p_clinic_id uuid)
returns table (
  slug             text,
  label            text,
  descricao        text,
  ia_pode_escolher boolean,
  ordem            int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    lr.slug,
    coalesce(
      clr.label_custom,
      case c.category
        when 'clinica' then lr.label_clinica
        when 'outro'   then lr.label_outro
        else null
      end,
      lr.label
    ) as label,
    lr.descricao,
    coalesce(clr.ia_pode_escolher, lr.ia_pode_escolher) as ia_pode_escolher,
    coalesce(clr."position", lr."position") as ordem
  from public.loss_reasons lr
  join public.clinics c on c.id = p_clinic_id
  left join public.clinic_loss_reasons clr
         on clr.clinic_id = p_clinic_id and clr.slug = lr.slug
  where lr.ativo
    and not lr.is_system
    and coalesce(clr.enabled, true)
    -- categorias: motivo que não faz sentido para a marca não aparece (ex.: faltou/cancelou,
    -- que nasce de agenda e é zero no WakeDesk). Override explícito da clínica ganha.
    and (c.category = any(lr.categorias) or clr.enabled is true)
  order by coalesce(clr."position", lr."position"), lr.slug;
$$;

comment on function public.fn_clinic_loss_reasons(uuid) is
  'Lista de motivos ATIVOS da clínica, com rótulo já resolvido por marca. Interna: service_role.';

-- ------------------------------------------------------------------ a mesma lista, para o front

create or replace function public.get_clinic_loss_reasons_impl(p_clinic_id uuid)
returns table (
  slug             text,
  label            text,
  descricao        text,
  ia_pode_escolher boolean,
  ordem            int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from public.fn_clinic_loss_reasons(p_clinic_id);
$$;

create or replace function public.get_clinic_loss_reasons(p_clinic_id uuid)
returns table (
  slug             text,
  label            text,
  descricao        text,
  ia_pode_escolher boolean,
  ordem            int
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Wrapper fino: guard de tenant e delega. A lógica mora no _impl (§1).
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.get_clinic_loss_reasons_impl(p_clinic_id);
end;
$$;

-- ------------------------------------------------------------------ permissões
-- O grant vem por DOIS caminhos e revogar um só não fecha nada: todo `create function` concede
-- EXECUTE a PUBLIC. Revogar de public, anon E authenticated, depois conceder nominalmente (§1).

revoke all on function public.fn_resolve_loss_reason(text)        from public, anon, authenticated;
revoke all on function public.fn_clinic_loss_reasons(uuid)        from public, anon, authenticated;
revoke all on function public.get_clinic_loss_reasons_impl(uuid)  from public, anon, authenticated;
revoke all on function public.get_clinic_loss_reasons(uuid)       from public, anon, authenticated;

-- service_role explícito nas internas: o ai-agent-worker chama fn_clinic_loss_reasons com
-- service_role, e sem este grant a lista sairia VAZIA em 100% das clínicas na estreia.
grant execute on function public.fn_resolve_loss_reason(text)       to service_role;
grant execute on function public.fn_clinic_loss_reasons(uuid)       to service_role;
grant execute on function public.get_clinic_loss_reasons_impl(uuid) to service_role;

-- só o wrapper com guard fica exposto ao app
grant execute on function public.get_clinic_loss_reasons(uuid) to authenticated, service_role;

