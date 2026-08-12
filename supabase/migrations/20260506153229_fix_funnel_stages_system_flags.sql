-- 20260506153229_fix_funnel_stages_system_flags
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Etapas sem slug viram is_system = false (editáveis pelo admin)
UPDATE public.funnel_stages SET is_system = false WHERE slug IS NULL;

-- Garante que etapas com slug são is_system = true (protegidas)
UPDATE public.funnel_stages SET is_system = true WHERE slug IS NOT NULL;

-- Corrige o seed para refletir a nova regra
CREATE OR REPLACE FUNCTION public.seed_default_funnel_stages(p_clinic_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.funnel_stages (clinic_id, name, slug, position, is_system, is_fixed, color) VALUES
    (p_clinic_id, 'Sincronização',        'sincronizacao', 0,  true,  false, 'bg-slate-500'),
    (p_clinic_id, 'Contato via Forms',    'forms',         1,  true,  false, 'bg-blue-500'),
    (p_clinic_id, 'Contato via WhatsApp', 'whatsapp',      2,  true,  false, 'bg-green-500'),
    (p_clinic_id, 'Qualificado',          null,            3,  false, false, 'bg-yellow-500'),
    (p_clinic_id, 'Orçamento Enviado',    null,            4,  false, false, 'bg-orange-500'),
    (p_clinic_id, 'Agendado',             null,            5,  false, false, 'bg-purple-500'),
    (p_clinic_id, 'Compareceu',           'compareceu',    6,  true,  false, 'bg-indigo-500'),
    (p_clinic_id, 'Conversão',            'conversao',     7,  true,  true,  'bg-teal-500'),
    (p_clinic_id, 'Paciente',             null,            8,  false, false, 'bg-emerald-500'),
    (p_clinic_id, 'Atendimento Humano',   null,            9,  false, false, 'bg-cyan-500'),
    (p_clinic_id, 'Perdido',              'perdido',       10, true,  false, 'bg-rose-500');
END;
$$;
