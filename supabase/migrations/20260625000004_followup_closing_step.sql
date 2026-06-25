-- Passo de ENCERRAMENTO da régua de reengajamento.
-- Um passo pode ser marcado como is_closing: ele envia a despedida ("estamos finalizando por falta
-- de retorno...") e a edge move o ticket para a etapa Perdido (SÓ a etapa — não resolve; um humano
-- verifica e resolve). Dispara delay_minutes após o último followup, se o lead não respondeu.

alter table public.followup_steps
  add column if not exists is_closing boolean not null default false;

comment on column public.followup_steps.is_closing is
  'Passo de encerramento: além da mensagem, move o ticket aberto para a etapa Perdido (sem resolver). Ver 20260625000004.';

-- fn_check_followup_exhausted: se a clínica tem passo de encerramento, é ELE quem move pra Perdido
-- (na edge, com despedida). Aqui então não fazemos nada. Sem passo de encerramento, mantém o
-- comportamento antigo (esgotou o nº de passos → move pra Perdido seco) como fallback.
create or replace function public.fn_check_followup_exhausted()
 returns trigger
 language plpgsql
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

  -- com passo de encerramento, o Perdido é feito pela edge (com mensagem). Não marca aqui.
  if v_has_closing then return NEW; end if;

  if v_total is null or v_total = 0 or NEW.followup_count < v_total then
    return NEW;
  end if;

  select id into v_perdido_id
  from public.funnel_stages
  where clinic_id = NEW.clinic_id and name = 'Perdido'
  limit 1;

  if v_perdido_id is not null then
    update public.tickets
      set stage_id = v_perdido_id
      where lead_id = NEW.id and status = 'open' and stage_id is distinct from v_perdido_id;
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  end if;

  return NEW;
end;
$function$;
