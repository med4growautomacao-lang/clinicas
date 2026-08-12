-- 20260727165227_default_deny_execute_public
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Default-deny de EXECUTE no schema public: fecha a CAUSA RAIZ e o que ela já tinha deixado aberto.
--
-- CAUSA RAIZ (o que faltava nas migrations anteriores desta semana):
-- `pg_default_acl` do schema public, objeto 'f', está assim:
--     {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- Ou seja, TODA função criada aqui já nasce executável por `anon`. Revogar função por função,
-- como fiz em 20260727155243 e 20260727155623, conserta o passado e não sobrevive ao próximo
-- `create function` — o buraco se reabre sozinho na migration seguinte.
--
-- Correção da minha própria regra: eu documentei que anon executa "por herdar de PUBLIC". Errado.
-- Neste banco as funções carregam OS DOIS grants, por causa do default acl acima:
--     find_patient_by_phone.proacl = {=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}
-- `revoke ... from public` remove só o `=X` e deixa `anon=X` de pé, com
-- has_function_privilege('anon', ...) ainda true. Tem que revogar de public E dos roles nominais.
--
-- O QUE ESTAVA ABERTO (SECURITY DEFINER, sem checagem nenhuma, anon-executável):
--   * delete_user_full(uuid) — o pior: faz DELETE FROM auth.users, clinic_users, org_users e
--     prontuario_passwords, sem guard. Com a anon key (pública, vai no bundle do front) dava para
--     apagar QUALQUER usuário, inclusive o super-admin. Não foi testado por ser destrutivo:
--     o corpo e o grant bastam.
--   * find_patient_by_phone(uuid,text) — verificado: devolveu a `anon` nome e **CPF** de paciente.
--   * emit_message(...) — enfileira mensagem de WhatsApp para qualquer número, em qualquer clínica.
--   * os workers do Emissor, os process_*/cron, os ingest_* e os onboarding_*.
--
-- Nada disso foi introduzido esta semana; é anterior. Foi confirmado agora.
--
-- ESTRATÉGIA, deliberadamente conservadora:
--   1. `alter default privileges` para o futuro (a parte que faltava).
--   2. `anon` perde EXECUTE em toda função DEFINER sem checagem. Risco ~zero: o front sempre fala
--      autenticado, e `anon` não tem uso legítimo em nenhuma delas.
--   3. `authenticated` só perde nas comprovadamente backend-only (destrutivas, PII, fila de envio).
--      Não saio revogando `authenticated` em massa porque um falso negativo do grep quebraria tela
--      em produção; o vetor não-autenticado, que é o grave, já fica fechado pelo item 2.
--
-- ⚠️ INTOCADAS de propósito: as funções que aparecem DENTRO de policies (is_clinic_active,
-- is_clinic_admin, is_super_admin, is_admin, has_clinic_access, my_clinic_ids, get_my_clinic_id,
-- check_org_access, can_manage_org, can_manage_clinic, is_org_owner). A policy é avaliada no papel
-- do chamador: sem EXECUTE, a avaliação falha com "permission denied for function" em vez de
-- simplesmente não casar, e isso derruba a leitura da tabela inteira.

-- 1. Futuro: nova função não nasce mais aberta ----------------------------------
-- Sem FOR ROLE = vale para objetos criados pelo role corrente (postgres), que é quem roda as
-- migrations. A partir daqui, RPC nova para o front precisa de GRANT EXPLÍCITO:
--     grant execute on function public.minha_rpc(...) to authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- 2/3. Passado: fecha o que o default acl já tinha aberto ------------------------
do $$
declare
  r record;
  -- backend-only comprovado (edge/cron com service_role; nenhuma chamada no front):
  -- estas perdem também `authenticated`.
  v_backend_only text[] := array[
    'delete_user_full', 'find_patient_by_phone', 'emit_message',
    'claim_outbound_messages', 'mark_outbound_sent', 'mark_outbound_failed',
    'mark_outbound_infra_blocked', 'outbound_register_chat', 'requeue_stale_outbound',
    'purge_outbound_messages', 'sandbox_reset', 'sandbox_session',
    '_onboarding_import_run', 'onboarding_deep_sync_tick',
    'process_appointment_reminders', 'process_confirmation_reminders',
    'process_handoff_auto_return', 'process_pos_followup', 'process_sla_unanswered',
    'run_scheduled_reports', 'recover_whatsapp_zombies', 'refresh_lead_attribution',
    'fn_reconcile_pending_tracking', 'fn_resolve_missing_ad_ids', 'fn_purge_ticket_sale',
    'fn_apply_inbox_to_lead', 'fn_claim_touchpoints_for_lead',
    'ingest_external_form_lead', 'ingest_meta_form_lead', 'apply_external_crm_outcome',
    'import_historical_lead', 'bump_external_capture'
  ];
  -- usadas dentro de POLICY: não tocar, sob pena de quebrar a leitura das tabelas.
  v_policy_helpers text[] := array[
    'is_clinic_active', 'is_clinic_admin', 'is_super_admin', 'is_admin', 'has_clinic_access',
    'my_clinic_ids', 'get_my_clinic_id', 'check_org_access', 'can_manage_org',
    'can_manage_clinic', 'is_org_owner'
  ];
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and not (p.proname = any(v_policy_helpers))
      -- sem nenhuma noção de quem chama no corpo
      and p.prosrc !~ 'auth\.uid|is_super_admin|is_clinic_admin|has_clinic_access|assert_clinic_access|can_manage_clinic|can_manage_org|check_org_access|is_org_owner|is_admin'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if r.proname = any(v_backend_only) then
      execute format('revoke all on function %s from authenticated', r.sig);
    end if;
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
