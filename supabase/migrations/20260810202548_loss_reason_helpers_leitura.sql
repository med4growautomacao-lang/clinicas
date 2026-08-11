-- Auxiliares de LEITURA do motivo de perda, usados pelos painéis.
--
-- Desenho para não exigir deploy sincronizado de banco e front: o filtro aceita **rótulo OU
-- código**. Enquanto o front ainda manda "Preço alto", a função traduz para preco_sem_orcamento;
-- quando o front passar a mandar o código, ele passa direto. Sem isso, o dia entre o deploy do
-- banco e o do front seria um dia de Comercial zerado, que o usuário lê como "não teve perda".

-- v_kpi_outcomes ganha o slug. Coluna NOVA no fim: nada que já lia a view muda de posição.
create or replace view public.v_kpi_outcomes as
 SELECT t.id AS ticket_id,
    t.lead_id,
    t.clinic_id,
    ((COALESCE(t.outcome_at, t.closed_at) AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
    t.outcome,
    t.loss_reason,
        CASE
            WHEN (l.source = 'meta_ads'::text) THEN 'meta_ads'::text
            WHEN (l.source = 'google_ads'::text) THEN 'google_ads'::text
            ELSE 'no_track'::text
        END AS platform,
        CASE
            WHEN (l.capture_channel = 'forms'::text) THEN 'forms'::text
            WHEN (l.capture_channel = 'balcao'::text) THEN 'balcao'::text
            ELSE 'whatsapp'::text
        END AS channel,
    t.loss_reason_slug
   FROM (tickets t
     JOIN leads l ON ((l.id = t.lead_id)))
  WHERE ((t.outcome = ANY (ARRAY['ganho'::text, 'perdido'::text])) AND (COALESCE(l.is_not_lead, false) = false));

-- ------------------------------------------------------------------ rótulo para exibição
-- ⚠️ Devolve o RÓTULO, não o código. É load-bearing para o relatório automático do dono:
-- build_commercial_report lê `elem->>'reason'` do jsonb do painel e manda por WhatsApp. Se o
-- painel passasse a devolver o código, ele receberia "sem_resposta (412)".
create or replace function public.fn_loss_reason_label(
  p_clinic_id uuid,
  p_slug text,
  p_texto text
)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    -- 1) rótulo do catálogo, já resolvido por marca e por override da clínica
    (select l.label from public.fn_clinic_loss_reasons(p_clinic_id) l where l.slug = p_slug),
    -- 2) motivo de sistema (fora da lista da clínica) ainda precisa de nome legível
    (select coalesce(lr.label_clinica, lr.label_outro, lr.label)
       from public.loss_reasons lr where lr.slug = p_slug),
    -- 3) sem catálogo: o texto original, que é o snapshot do que a clínica escreveu
    nullif(btrim(coalesce(p_texto, '')), ''),
    '(sem motivo registrado)'
  );
$$;

-- ------------------------------------------------------------------ filtro tolerante
create or replace function public.fn_loss_filter_match(
  p_slug text,
  p_texto text,
  p_filtro text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    case
      when p_filtro is null or btrim(p_filtro) = '' then true
      else
        -- chave efetiva do ticket: código, ou tradução do texto, ou o balde de sem motivo
        coalesce(p_slug, public.fn_resolve_loss_reason(p_texto), '(sem motivo registrado)')
        = any (
          select coalesce(public.fn_resolve_loss_reason(btrim(e)), btrim(e))
          from unnest(string_to_array(p_filtro, ',')) as e
        )
    end;
$$;

comment on function public.fn_loss_filter_match(text, text, text) is
  'Filtro de motivo de perda que aceita rótulo OU código nos dois lados. Permite deploy de banco e front em momentos diferentes sem zerar o painel.';

revoke all on function public.fn_loss_reason_label(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fn_loss_filter_match(text, text, text) from public, anon, authenticated;
-- Chamadas de DENTRO das RPCs de painel (que são SECURITY DEFINER e rodam como postgres) e do
-- cron do relatório. Não precisam de grant para authenticated.
grant execute on function public.fn_loss_reason_label(uuid, text, text) to service_role;
grant execute on function public.fn_loss_filter_match(text, text, text) to service_role;

