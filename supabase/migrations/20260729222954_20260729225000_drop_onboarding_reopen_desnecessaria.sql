-- 20260729222954_20260729225000_drop_onboarding_reopen_desnecessaria
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove onboarding_reopen criada minutos antes: virou desnecessária e seria função órfã.
-- Por quê: o botão "Organizar contatos" abre o modal por estado LOCAL do componente (forceOpen), que
-- não passa pelo gate, então não precisa limpar clinics.onboarding_completed_at. E limpar seria
-- PIOR: faria o modal voltar a abrir sozinho para TODOS os usuários daquela clínica, não só para
-- quem clicou.
-- Reabrir preservando a auditoria continua possível pelo botão; recomeçar do zero segue sendo o
-- "Refazer onboarding" (onboarding_reset), em Organizações.
DROP FUNCTION IF EXISTS public.onboarding_reopen(uuid);
