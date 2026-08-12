-- 20260722022947_followup_candidates_revoke_from_public
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O revoke anterior (from anon, authenticated) NÃO surtiu efeito: no Postgres toda função nasce com
-- EXECUTE para PUBLIC, e anon/authenticated herdam por aí. Revogar dos papéis não tira o grant de
-- PUBLIC. Verificado com `set local role authenticated`: a função de candidatos ainda executava.
-- O correto é revogar de PUBLIC. O dono (postgres) mantém execute, então o preview (security definer,
-- owned by postgres) e os motores (cron, postgres) seguem chamando normalmente.
revoke all on function public.fn_clinic_can_send(uuid)                  from public;
revoke all on function public.fn_followup_candidates_welcome(uuid)      from public;
revoke all on function public.fn_followup_candidates_reengagement(uuid) from public;
revoke all on function public.fn_followup_candidates_confirmation(uuid) from public;
revoke all on function public.fn_followup_candidates_pos(uuid)          from public;

-- Mesma armadilha na própria RPC do preview: o `revoke ... from anon` da migration 019 nunca teve
-- efeito. Ela é protegida pela checagem de permissão interna (anon tem auth.uid() nulo e leva
-- 'Sem permissão'), mas o grant deve ser explícito em vez de herdado de PUBLIC.
revoke all on function public.preview_followup_activation(uuid, text)   from public;
grant execute on function public.preview_followup_activation(uuid, text) to authenticated;
