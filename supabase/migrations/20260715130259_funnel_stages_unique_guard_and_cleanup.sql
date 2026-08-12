-- 20260715130259_funnel_stages_unique_guard_and_cleanup
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- TRAVA: impossível ter dois estágios com o mesmo slug na mesma clínica. Protege o motor
-- (forms/ganho/perdido/sincronizacao/etc.) contra qualquer duplicação futura, inclusive insert manual.
-- Slugs nulos (Qualificado/Orçamento/Agendado) ficam de fora do índice de propósito (podem repetir
-- nome, mas não são chave do motor; e o fix da RPC já evita a recorrência).
CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_stages_clinic_slug
  ON public.funnel_stages (clinic_id, slug)
  WHERE slug IS NOT NULL;

-- Remove o helper de merge (uso único, já cumpriu o papel).
DROP FUNCTION IF EXISTS public._merge_clinic_funnel_dups(uuid);

-- Remove o seeder LEGADO divergente (modelo Conversão/Paciente/Atendimento Humano). Já não é
-- chamado por ninguém (as duas sobrecargas de create_clinic_with_owner foram corrigidas). Manter
-- seria um footgun: quem o chamasse reintroduziria o esquema errado. Fonte única = handle_new_clinic.
DROP FUNCTION IF EXISTS public.seed_default_funnel_stages(uuid);
