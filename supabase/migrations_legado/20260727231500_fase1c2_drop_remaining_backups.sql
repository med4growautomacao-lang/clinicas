-- Complemento da fase1c: dropa os 4 backups datados que eu havia preservado (dono confirmou
-- "corrija todas"). Consumidos (snapshots de 22/07, operações concluídas), 0 FKs, 0 funções citam.
drop table if exists public._backup_prompt_templates_20260722;
drop table if exists public._lead_merge_backup_20260722;
drop table if exists public._lead_merge_plan_20260722;
drop table if exists public._orphan_tickets_backup_20260722;
