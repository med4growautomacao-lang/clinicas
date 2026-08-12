-- 20260722011221_seed_stages_missing_slug
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

create or replace function public.handle_new_clinic()
returns trigger
language plpgsql
security definer
as $$
BEGIN
    INSERT INTO public.ai_config (clinic_id)
    VALUES (NEW.id) ON CONFLICT (clinic_id) DO NOTHING;

    INSERT INTO public.whatsapp_instances (clinic_id, api_token, api_id)
    VALUES (NEW.id, '', NULL) ON CONFLICT (clinic_id) DO NOTHING;

    INSERT INTO public.funnel_stages (clinic_id, name, slug, position, color, is_system, is_hidden) VALUES
      (NEW.id, 'Sincronização',        'sincronizacao',   0, '#8b5cf6',       true,  true),
      (NEW.id, 'Contato via Forms',    'forms',           1, 'bg-blue-500',   true,  false),
      (NEW.id, 'Contato via WhatsApp', 'whatsapp',        2, 'bg-emerald-500',true,  false),
      (NEW.id, 'Qualificado',          'qualificado',     3, 'bg-teal-500',   false, false),
      (NEW.id, 'Orçamento Enviado',    'orcamento',       4, 'bg-purple-500', false, false),
      (NEW.id, 'Agendado',             'agendado',        5, 'bg-amber-500',  false, false),
      (NEW.id, 'Compareceu',           'compareceu',      6, 'bg-indigo-500', false, false),
      (NEW.id, 'Ganho',                'ganho',           7, 'bg-green-600',  true,  false),
      (NEW.id, 'Faltou/Cancelou',      'faltou_cancelou', 8, 'bg-orange-500', false, false),
      (NEW.id, 'Perdido',              'perdido',         9, 'bg-red-600',    true,  false)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

with mapa(nome, slug_alvo) as (values
  ('Qualificado',       'qualificado'),
  ('Orçamento Enviado', 'orcamento'),
  ('Agendado',          'agendado')
)
update public.funnel_stages fs
   set slug = m.slug_alvo
  from mapa m
 where fs.slug is null
   and fs.name = m.nome
   and not exists (
     select 1 from public.funnel_stages outra
      where outra.clinic_id = fs.clinic_id and outra.slug = m.slug_alvo
   );

commit;
