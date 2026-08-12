-- 20260727223302_20260727223052_fase1c_drop_scratch_tables
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 1c: remove as tabelas de trabalho expostas. Dependências conferidas: 0 FKs e 0 funções
-- citam qualquer uma delas.
--
-- Grupo 1: RLS OFF com dados = o vazamento real (anon lia/escrevia via PostgREST). DROP.
drop table if exists public._pre_resolve_ids_20260725;
drop table if exists public._rehygiene_intubacao_20260724;
drop table if exists public._backfill_ad_ids_20260725;
drop table if exists public._clint_bf_20260725;
drop table if exists public._clint_bf_datas_backup_20260725;
drop table if exists public._clint_bf_hist_backup_20260725;
drop table if exists public._cleanup_testes_20260725_leads;
drop table if exists public._cleanup_testes_20260725_subs;
drop table if exists public._cleanup_testes_20260725_tickets;

-- Grupo 2: datadas vazias (0 linhas) = puro entulho, zero perda de dado. DROP.
drop table if exists public._backfill_gatilhos_20260701;
drop table if exists public._backfill_gheller_perdido_20260622;
drop table if exists public._backfill_rentawish_ganho_20260622;
drop table if exists public._backfill_tickets_sem_etapa_20260713;
drop table if exists public._backfill_tyago_instagram_20260618;
drop table if exists public._backfill_tyago_instagram_20260709;
drop table if exists public._ct_desc_backup_20260714;
drop table if exists public._ctwa_backfill_20260713;
drop table if exists public._deleted_dup_site_forms_touchpoints_20260713;
drop table if exists public._deleted_link_sessions_direto_20260713;
drop table if exists public._fix_leads_rast_id_protocolo_20260713;
drop table if exists public._inbox_dedup_20260713;
drop table if exists public._leads_lasttouch_20260714;
drop table if exists public._system_settings_backup_20260715;
drop table if exists public._vaz_block_all_lote4_20260713;
drop table if exists public._vaz_followup_off_20260713;
drop table if exists public._vaz_followup_off_lote2_20260713;
drop table if exists public._vaz_followup_off_lote3_20260713;

-- Grupo 3: backups datados AINDA com dados (RLS on, não expostos). NÃO dropo (irreversível);
-- só revogo anon/authenticated em nível de tabela como defesa em profundidade. Dropar depois
-- que o dono validar.
revoke all on table public._backup_prompt_templates_20260722 from anon, authenticated;
revoke all on table public._lead_merge_backup_20260722 from anon, authenticated;
revoke all on table public._lead_merge_plan_20260722 from anon, authenticated;
revoke all on table public._orphan_tickets_backup_20260722 from anon, authenticated;
