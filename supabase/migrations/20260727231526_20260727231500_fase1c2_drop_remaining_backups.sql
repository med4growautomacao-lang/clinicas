-- 20260727231526_20260727231500_fase1c2_drop_remaining_backups
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Complemento da fase1c: dropa os 4 backups datados que eu havia preservado (dono confirmou
-- "corrija todas"). Consumidos (snapshots de 22/07, operações concluídas), 0 FKs, 0 funções citam.
drop table if exists public._backup_prompt_templates_20260722;
drop table if exists public._lead_merge_backup_20260722;
drop table if exists public._lead_merge_plan_20260722;
drop table if exists public._orphan_tickets_backup_20260722;
