-- Ocultar etapa do quadro sem excluí-la.
--
-- Motivação: 'Sincronização' precisou sumir do Kanban (virou lixeira do fallback, ver
-- 20260721000014), mas é is_system e não pode ser excluída. A primeira versão saiu como filtro
-- hardcoded no LeadKanban ('sincronizacao'), o que não é reversível pela tela e não serve para
-- nenhuma outra etapa. Esta migration troca isso por um flag de verdade.
--
-- Ocultar ≠ excluir: a etapa continua existindo, continua roteável pelo motor, continua nos
-- seletores de etapa e nos relatórios. Só não desenha coluna no quadro. Por isso é seguro
-- oferecer o toggle ao cliente: nada de dado é perdido, e é reversível a qualquer momento.

begin;

alter table public.funnel_stages
  add column if not exists is_hidden boolean not null default false;

comment on column public.funnel_stages.is_hidden is
  'Etapa existe e recebe lead normalmente, mas não desenha coluna no Kanban. Toggle do olho na configuração de funil. NÃO é exclusão.';

-- 'Sincronização' oculta em todas as clínicas (decisão do dono 21/07: vale para todas, não é
-- escolha por clínica). Reversível pelo botão, já que o dono chamou de "temporário".
update public.funnel_stages
set is_hidden = true
where slug = 'sincronizacao' and is_hidden = false;

-- Clínica NOVA já nasce com ela oculta, senão a coluna volta a aparecer só para os clientes novos.
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

-- Etapa de sistema não podia ser EXCLUÍDA pela UI (o botão é escondido desde 07/05/2026), mas nada
-- no banco impedia: as policies de funnel_stages são ALL e não olham is_system, e a única trava
-- existente (tr_lock_forms_stage_name) cobre só UPDATE OF name. Resultado: a clínica Tyago Venâncio
-- ficou sem a etapa 'forms' (nasceu com ela em 09/04, sumiu depois), e leads de formulário passaram
-- a cair noutra coluna em silêncio. Agora o banco recusa.
-- SECURITY DEFINER de propósito: o guard decide olhando public.clinics, e sob RLS um usuário que
-- não enxerga a linha da clínica faria o EXISTS devolver false, liberando o delete justamente para
-- quem tem menos visibilidade. Guard de invariante tem que falhar FECHADO, então roda como owner e
-- enxerga a tabela inteira. search_path fixo porque SECURITY DEFINER sem ele é sequestrável.
create or replace function public.fn_block_system_stage_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
BEGIN
  -- funnel_stages.clinic_id é ON DELETE CASCADE: excluir uma CLÍNICA precisa continuar levando as
  -- etapas junto. Quando o cascade está em curso a linha de clinics já saiu no snapshot desta
  -- transação, então a ausência dela é o sinal de "não é o cliente apagando uma etapa".
  IF OLD.is_system AND EXISTS (SELECT 1 FROM public.clinics WHERE id = OLD.clinic_id) THEN
    RAISE EXCEPTION 'A etapa "%" é uma etapa de sistema e não pode ser excluída. Use o botão de ocultar (olho) na configuração de funil.', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- Função de trigger não é para ser chamada direto por ninguém.
revoke all on function public.fn_block_system_stage_delete() from public, anon, authenticated;

drop trigger if exists tr_block_system_stage_delete on public.funnel_stages;
create trigger tr_block_system_stage_delete
  before delete on public.funnel_stages
  for each row execute function public.fn_block_system_stage_delete();

commit;
