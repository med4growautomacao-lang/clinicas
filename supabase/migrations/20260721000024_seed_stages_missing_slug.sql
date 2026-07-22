-- O seed de clínica nova criava etapas SEM slug, e slug é a chave do motor.
--
-- handle_new_clinic inseria 'Qualificado', 'Orçamento Enviado' e 'Agendado' com slug NULL. Só que
-- 'agendado' é lido por SETE lugares: fn_auto_move_lead_to_agendado, fn_auto_link_ticket_on_appointment,
-- fn_resolve_patient_lead_ticket, get_commercial_dashboard, get_org_clinics_metrics,
-- process_reengagement_followup e preview_followup_activation. Sem o slug, todos eles simplesmente
-- não acham a etapa e seguem em frente calados (o padrão é `IF ... IS NULL THEN RETURN NEW`).
--
-- Alguém já tinha feito backfill dos slugs nas clínicas antigas, mas não corrigiu o seed. O corte é
-- limpo: clínica criada até 13/05 tem slug, criada de 22/05 em diante não tem. Ficaram assim
-- São Lucas, MedDesk Comercial, Intubação e Meta Tester, e toda clínica nova herdaria o defeito.
--
-- Dano ainda era zero (as 4 não têm nenhum agendamento e estão com agenda_via_funil=false), então
-- isto é desarmar bomba, não apagar incêndio: o sintoma apareceria no dia em que uma delas usasse a
-- agenda, com o card não indo para "Agendado" e ninguém entendendo por quê.
--
-- É o mesmo defeito de [funnel_stages.slug é chave do motor] que deixou uma clínica sem 'forms':
-- etapa sem slug é decorativa para o motor, por mais certo que esteja o nome na tela.

begin;

-- (1) O seed passa a nascer com os slugs. Demais colunas idênticas às de hoje.
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

-- (2) Backfill das que já nasceram tortas.
--
-- Casa por NOME, que normalmente seria o erro (nome de etapa é texto livre), mas aqui é o único
-- sinal que resta: a linha não tem slug, justamente o que queremos preencher. O risco fica contido
-- porque só toca linha que ainda está com o nome EXATO do seed e sem slug nenhum. Etapa criada ou
-- renomeada pelo cliente ('Entregue/Pago' da Metaltres, 'nova etapa' da Personalite) não casa e
-- segue sem slug, que é o certo: ela não é etapa de motor.
--
-- O NOT EXISTS protege o índice uq_funnel_stages_clinic_slug (unique por clinic_id+slug): se a
-- clínica já tiver outra etapa ocupando o slug, esta fica como está em vez de estourar a migration.
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
