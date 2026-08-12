-- A Central de Erros perdia avisos EM SILÊNCIO — dentro da própria ferramenta anti-silêncio.
--
-- Cadeia do bug (achada testando token inválido no external-forms-ingest, 15/07):
--   1. O CHECK `system_errors_level_chk` aceita 'warn' | 'error' | 'critical'.
--   2. Edges chamavam log_system_error com p_level='warning' (external-forms-ingest 2×,
--      external-crm-status 1×) → INSERT rejeitado pela constraint.
--   3. O helper `registrarErro()` das edges faz `await supa.rpc(...)` SEM ler o `{error}`
--      retornado — o supabase-js NÃO lança exceção em erro de RPC, devolve o erro no objeto.
--      O catch nunca dispara, nada aparece em lugar nenhum.
--   Resultado: scope 'external-forms-ingest' tinha ZERO linhas na Central desde sempre.
--
-- Fix na RAIZ: o RPC normaliza o nível — qualquer variação razoável cai num nível válido e
-- desconhecido vira 'error' (na dúvida, mais visível, nunca descartado). Protege TODOS os
-- chamadores (inclusive o external-crm-status, que não precisa de redeploy).
-- Nas edges novas o helper também passa a logar o {error} no console (visibilidade).

begin;

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
  -- Normalização: nunca deixar o registro morrer por grafia do nível.
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
               else 'error'    -- desconhecido: mais visível, jamais descartado
             end;

  -- '-' (não ''): é o valor da versão original — mudar quebraria os fingerprints já agregados.
  v_fp := md5(p_scope || '|' || p_code || '|' || coalesce(p_clinic_id::text, '-'));

  insert into public.system_errors as e (
    fingerprint, scope, code, level, title, clinic_id, is_monitor, last_context
  ) values (
    v_fp, p_scope, p_code, v_level, p_title, p_clinic_id,
    coalesce(p_is_monitor, false), p_context
  )
  on conflict (fingerprint) do update set
    -- Evento conta; condição só atualiza "visto agora".
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

commit;

-- ============================================================================
-- ROLLBACK: reaplicar a versão de 20260714000005 (sem a normalização de nível).
-- ============================================================================
