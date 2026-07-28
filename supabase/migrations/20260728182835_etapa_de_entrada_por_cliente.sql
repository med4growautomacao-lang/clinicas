-- ETAPA DE ENTRADA POR CLIENTE: "Formularios" ou "WhatsApp".
--
-- Ate aqui TODO lead que entra sem conversa nascia na etapa 'forms', porque
-- fn_auto_open_ticket_forms passava o slug fixo. O CRM era a unica excecao:
-- preferia 'whatsapp' desde 27/07. Essa excecao nunca teve efeito nenhum --
-- conferido em 28/07, as duas clinicas com CRM tem ZERO evento outcome='lead'
-- (a Intubacao nem tem lead_enabled), entao o ramo que escolhia a etapa nunca
-- rodou. Na pratica, 100% dos cards entram em 'forms' (Intubacao 2.573 em 14
-- dias, GG Imports 52), e nao havia como um cliente pedir diferente.
--
-- Agora a escolha e do cliente, numa chave so, e vale para os dois caminhos de
-- entrada sem conversa (formulario e CRM).
--
-- ESCOPO DELIBERADO: a chave decide APENAS a etapa (onde o card nasce). Ela NAO
-- toca leads.capture_channel. Canal e fato de origem ("como chegou", §2 do
-- CLAUDE.md) e etapa e escolha de fluxo de trabalho; amarrar um no outro faria
-- um lead de formulario ser contado como WhatsApp nos paineis, que e justamente
-- a corrupcao que a regra do canal existe para impedir.

alter table public.clinic_external_integrations
  add column if not exists entry_stage_slug text not null default 'forms';

alter table public.clinic_external_integrations
  drop constraint if exists cei_entry_stage_slug_check;
alter table public.clinic_external_integrations
  add constraint cei_entry_stage_slug_check
  check (entry_stage_slug in ('forms', 'whatsapp'));

comment on column public.clinic_external_integrations.entry_stage_slug is
  'Etapa do funil em que o card NASCE para lead que entra sem conversa (formulario e CRM): forms|whatsapp. Nao altera o canal do lead. Default forms = comportamento historico.';

-- Fonte unica da escolha. Cliente sem linha de integracao (a linha e criada sob
-- demanda pela tela) cai em 'forms', que e exatamente o que acontece hoje.
create or replace function public.fn_clinic_entry_stage_slug(p_clinic_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(trim(i.entry_stage_slug), '')
       from public.clinic_external_integrations i
      where i.clinic_id = p_clinic_id),
    'forms');
$function$;

-- Default-deny (§1 do CLAUDE.md): so os DEFINER internos precisam dela, e esses
-- rodam como o dono. Ninguem do PostgREST chama isto direto.
revoke all on function public.fn_clinic_entry_stage_slug(uuid) from public, anon, authenticated;

-- 1) Formulario (nativo e de site): slug fixo 'forms' -> escolha do cliente.
create or replace function public.fn_auto_open_ticket_forms()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_stage_id UUID;
BEGIN
  IF NEW.capture_channel IS DISTINCT FROM 'forms' THEN
    RETURN NEW;
  END IF;

  -- Intake do CRM externo: quem abre o ticket e escolhe a etapa e a propria RPC
  -- (apply_external_crm_outcome).
  IF coalesce(current_setting('app.crm_intake', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tickets WHERE lead_id = NEW.id AND status = 'open') THEN
    RETURN NEW;
  END IF;

  -- Era 'forms' fixo. Agora segue a chave do cliente; sem chave, continua 'forms'.
  v_stage_id := public.fn_default_entry_stage(NEW.clinic_id, public.fn_clinic_entry_stage_slug(NEW.clinic_id));

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, NEW.id, v_stage_id, 'open', NOW());

  RETURN NEW;
END;
$function$;

-- 2) CRM externo: patch AO VIVO (pg_get_functiondef + replace), mesmo padrao das
-- migrations 20260622000001/000006. E o corpo tem ~150 linhas e outra sessao pode
-- estar mexendo nele; reescrever inteiro daqui apagaria o trabalho dela em silencio.
do $do$
declare
  v_def   text;
  v_velho text := 'v_stage_id := public.fn_default_entry_stage(p_clinic_id, ''whatsapp'');';
  v_novo  text := 'v_stage_id := public.fn_default_entry_stage(p_clinic_id, public.fn_clinic_entry_stage_slug(p_clinic_id));';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_external_crm_outcome';

  if v_def is null then
    raise exception 'apply_external_crm_outcome nao encontrada';
  end if;

  if position(v_velho in v_def) = 0 then
    -- Ja aplicado, ou outra sessao mudou a linha. Falhar alto e melhor que
    -- deixar o CRM com etapa fixa achando que a chave passou a valer.
    if position(v_novo in v_def) > 0 then
      raise notice 'apply_external_crm_outcome ja usa a chave do cliente; nada a fazer';
      return;
    end if;
    raise exception 'nao achei a linha da etapa em apply_external_crm_outcome (alguem mudou); revise a mao';
  end if;

  execute replace(v_def, v_velho, v_novo);
end
$do$;

-- GG Imports (WakeDesk, loja): os cards entram na etapa de WhatsApp. Decisao do
-- dono em 28/07. A linha de integracao ja existe; o insert e so rede de seguranca.
insert into public.clinic_external_integrations (clinic_id, entry_stage_slug)
values ('ae15482b-c891-4b75-b19e-1faa60f0296a', 'whatsapp')
on conflict (clinic_id) do update
   set entry_stage_slug = 'whatsapp', updated_at = now();
