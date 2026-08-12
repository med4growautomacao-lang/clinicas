-- 20260721222454_funnel_stage_is_hidden
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

alter table public.funnel_stages
  add column if not exists is_hidden boolean not null default false;

comment on column public.funnel_stages.is_hidden is
  'Etapa existe e recebe lead normalmente, mas não desenha coluna no Kanban. Toggle do olho na configuração de funil. NÃO é exclusão.';

update public.funnel_stages
set is_hidden = true
where slug = 'sincronizacao' and is_hidden = false;

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
      (NEW.id, 'Qualificado',          null,              3, 'bg-teal-500',   false, false),
      (NEW.id, 'Orçamento Enviado',    null,              4, 'bg-purple-500', false, false),
      (NEW.id, 'Agendado',             null,              5, 'bg-amber-500',  false, false),
      (NEW.id, 'Compareceu',           'compareceu',      6, 'bg-indigo-500', false, false),
      (NEW.id, 'Ganho',                'ganho',           7, 'bg-green-600',  true,  false),
      (NEW.id, 'Faltou/Cancelou',      'faltou_cancelou', 8, 'bg-orange-500', false, false),
      (NEW.id, 'Perdido',              'perdido',         9, 'bg-red-600',    true,  false)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

create or replace function public.fn_block_system_stage_delete()
returns trigger
language plpgsql
as $$
BEGIN
  IF OLD.is_system AND EXISTS (SELECT 1 FROM public.clinics WHERE id = OLD.clinic_id) THEN
    RAISE EXCEPTION 'A etapa "%" é uma etapa de sistema e não pode ser excluída. Use o botão de ocultar (olho) na configuração de funil.', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

drop trigger if exists tr_block_system_stage_delete on public.funnel_stages;
create trigger tr_block_system_stage_delete
  before delete on public.funnel_stages
  for each row execute function public.fn_block_system_stage_delete();

commit;
