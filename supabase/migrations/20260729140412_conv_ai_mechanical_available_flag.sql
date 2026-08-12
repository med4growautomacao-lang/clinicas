-- 20260729140412_conv_ai_mechanical_available_flag
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Flag de PLANO: libera o modo Mecânico na tela daquela clínica (o 4º botão só aparece
-- quando o plano da clínica inclui o motor mecânico). Default false = não aparece.
alter table public.conv_ai_clinic_config
  add column if not exists mechanical_available boolean not null default false;

-- São Lucas já tem o motor armado: libera o botão pra ela.
update public.conv_ai_clinic_config
  set mechanical_available = true
where clinic_id = '97c7eb50-11a1-425f-b227-30a5de625d2b';
