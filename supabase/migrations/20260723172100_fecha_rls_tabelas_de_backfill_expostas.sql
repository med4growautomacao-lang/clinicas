-- FECHA 30 tabelas que estavam em `public` SEM RLS, portanto legiveis pela API PostgREST por
-- qualquer cliente com a chave anon. Levantado pelo advisor de seguranca em 23/07/2026.
--
-- 28 sao residuo de backfill/migracao (`_backfill_*`, `_vaz_*`, `_deleted_*`, `_lead_merge_*`...)
-- e uma delas, `_lead_merge_backup_20260722`, foi marcada pelo proprio advisor como exposicao de
-- dado sensivel (contem `session_id`). Sao dados de PACIENTE de clinicas reais, servidos pela API
-- sem nenhum filtro de tenant.
--
-- 2 sao operacionais e continuam em uso: `system_http_calls` (mapa request_id -> URL, usado por
-- run_system_monitors) e `system_monitor_state` (cursor dos monitores). Expunham a topologia
-- interna: todas as URLs que o banco chama.
--
-- POR QUE `enable` SEM POLICY: e o fechamento total pela API mantendo o acesso interno intacto.
-- `service_role` tem BYPASSRLS e as funcoes SECURITY DEFINER rodam como dono da tabela (postgres,
-- verificado), entao run_system_monitors, os crons e as edges seguem lendo/escrevendo. Nenhum
-- arquivo em src/ referencia qualquer uma destas 30 tabelas (verificado por busca antes de aplicar).
--
-- Idempotente e tolerante a tabela ausente DE PROPOSITO: ha ate 4 sessoes trabalhando neste banco
-- ao mesmo tempo e uma delas pode ter dropado um residuo entre o levantamento e esta migration.
-- Rollback: `alter table <nome> disable row level security;`

do $$
declare
  t text;
  alvos text[] := array[
    -- operacionais (seguem em uso)
    'system_http_calls', 'system_monitor_state',
    -- residuo de backfill / backup / auditoria de migracao
    '_plat_map', '_occ_map', '_shadow_stage_rules', '_ticket_orphan_audit',
    '_orphan_tickets_backup_20260722', '_lead_merge_plan_20260722', '_lead_merge_backup_20260722',
    '_leads_lasttouch_20260714', '_ct_desc_backup_20260714', '_system_settings_backup_20260715',
    '_backfill_gatilhos_20260701', '_backfill_rentawish_ganho_20260622',
    '_backfill_tyago_instagram_20260618', '_backfill_tyago_instagram_20260709',
    '_backfill_gheller_perdido_20260622', '_backfill_tickets_sem_etapa_20260713',
    '_fix_leads_rast_id_protocolo_20260713', '_deleted_link_sessions_direto_20260713',
    '_deleted_dup_site_forms_touchpoints_20260713', '_vaz_followup_off_20260713',
    '_vaz_followup_off_lote2_20260713', '_vaz_followup_off_lote3_20260713',
    '_vaz_block_all_lote4_20260713', '_ctwa_backfill_20260713', '_inbox_dedup_20260713',
    'balcao_origin_backfill', 'comm_snapshot_v1', 'comm_rollback_ddl'
  ];
  n int := 0;
begin
  foreach t in array alvos loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      n := n + 1;
    end if;
  end loop;
  raise notice 'RLS habilitada em % tabela(s)', n;
end $$;
