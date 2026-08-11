-- A trava de follow-up esgotado é a MAIOR fonte de perda muda do sistema.
--
-- Medido em 10/08/2026: 361 leads marcados, e **360 já constam como PERDA no histórico** — porque
-- esta trigger move o card para a coluna Perdido e a trigger de consistência então marca
-- `outcome='perdido'` sozinha. Só que o motivo era escrito apenas em `leads.loss_reason`, campo
-- que painel NENHUM lê. Resultado: 360 perdas contadas e mudas, ou seja ~49% de todas as 739
-- perdas sem motivo do sistema.
--
-- Duas correções:
--   1. gravar o motivo também no TICKET (texto + slug canônico);
--   2. achar a coluna pelo SLUG, não pelo nome escrito. `name = 'Perdido'` quebra em silêncio no
--      dia em que um cliente renomear a coluna, e o slug é a chave do motor (funnel_stages.slug).

create or replace function public.fn_check_followup_exhausted()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_total int;
  v_has_closing boolean;
  v_perdido_id uuid;
begin
  if NEW.followup_count = OLD.followup_count then return NEW; end if;

  select count(*) filter (where enabled),
         coalesce(bool_or(enabled and is_closing), false)
    into v_total, v_has_closing
  from public.followup_steps
  where clinic_id = NEW.clinic_id;

  if v_has_closing then return NEW; end if;

  if v_total is null or v_total = 0 or NEW.followup_count < v_total then
    return NEW;
  end if;

  select id into v_perdido_id
  from public.funnel_stages
  where clinic_id = NEW.clinic_id and slug = 'perdido'
  limit 1;

  if v_perdido_id is not null then
    -- COALESCE nos dois motivos: se a equipe já tinha registrado algo, a automação não sobrescreve.
    -- Sem a condição de stage_id: card já em Perdido também precisa receber o motivo (era o caso
    -- em que a perda ficava muda para sempre).
    update public.tickets
      set stage_id         = v_perdido_id,
          loss_reason      = coalesce(loss_reason, 'Tentativas de follow-up esgotadas'),
          loss_reason_slug = coalesce(loss_reason_slug, 'sem_resposta')
      where lead_id = NEW.id and status = 'open';
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  end if;

  return NEW;
end;
$function$;

