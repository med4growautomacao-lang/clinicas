-- 20260715223503_log_system_error_normaliza_level
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ver supabase/migrations/20260715000002_log_system_error_normaliza_level.sql
-- A Central perdia avisos em silêncio: o CHECK aceita 'warn' e as edges mandavam 'warning';
-- o helper das edges não lê o {error} do supabase-js (que não lança exceção). Fix na raiz:
-- o RPC normaliza o nível — desconhecido vira 'error' (visível), nunca descartado.

create or replace function public.log_system_error(
  p_scope      text,
  p_code       text,
  p_title      text,
  p_level      text    default 'error',
  p_clinic_id  uuid    default null,
  p_context    jsonb   default null,
  p_is_monitor boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fp    text;
  v_id    uuid;
  v_level text;
begin
  v_level := case lower(trim(coalesce(p_level, 'error')))
               when 'warn'     then 'warn'
               when 'warning'  then 'warn'
               when 'aviso'    then 'warn'
               when 'info'     then 'warn'
               when 'error'    then 'error'
               when 'erro'     then 'error'
               when 'critical' then 'critical'
               when 'critico'  then 'critical'
               when 'crítico'  then 'critical'
               else 'error'
             end;

  v_fp := md5(p_scope || '|' || p_code || '|' || coalesce(p_clinic_id::text, '-'));

  insert into public.system_errors as e (
    fingerprint, scope, code, level, title, clinic_id, is_monitor, last_context
  ) values (
    v_fp, p_scope, p_code, v_level, p_title, p_clinic_id,
    coalesce(p_is_monitor, false), p_context
  )
  on conflict (fingerprint) do update set
    occurrences  = e.occurrences + case when coalesce(excluded.is_monitor, false) then 0 else 1 end,
    last_seen_at = now(),
    title        = excluded.title,
    level        = excluded.level,
    last_context = coalesce(excluded.last_context, e.last_context),
    status       = case when e.status = 'resolved' then 'open' else e.status end,
    resolved_at  = case when e.status = 'resolved' then null  else e.resolved_at end
  returning e.id into v_id;

  return v_id;
end;
$$;
