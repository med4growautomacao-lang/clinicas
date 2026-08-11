-- Painéis passam a agrupar e filtrar pelo motivo CANÔNICO.
--
-- Substituição no próprio DDL com contagem verificada: as três funções somam milhares de linhas e
-- recopiá-las à mão é como se perde um bloco. Se qualquer troca não bater a contagem esperada, a
-- migration falha inteira e nada é aplicado.
--
-- O que muda para quem lê:
--   - "Preço alto" e "Preço" deixam de disputar duas vagas no top-3 do relatório do dono;
--   - o filtro continua aceitando o RÓTULO antigo (o front ainda manda assim) e também o código;
--   - o jsonb do painel ganha 'slug' AO LADO de 'reason', sem tirar 'reason': build_commercial_report
--     lê exatamente essa chave para o WhatsApp do dono, e trocá-la mandaria "sem_resposta (412)".

do $mig$
declare
  v_src text;
  v_n   int;
begin
  -- ================================================= get_commercial_dashboard_impl
  select pg_get_functiondef(oid) into v_src
  from pg_proc where pronamespace='public'::regnamespace and proname='get_commercial_dashboard_impl';
  if v_src is null then raise exception 'get_commercial_dashboard_impl nao encontrada'; end if;

  -- (1) os 2 filtros por igualdade viram o matcher tolerante
  select count(*) into v_n from regexp_matches(v_src,
    'COALESCE\(NULLIF\(t\.loss_reason, ''''\), ''\(sem motivo registrado\)''\) = ANY\(string_to_array\(p_loss_reasons, '',''\)\)', 'g');
  if v_n <> 2 then raise exception 'esperava 2 filtros no dashboard, achei %', v_n; end if;

  v_src := replace(v_src,
    'COALESCE(NULLIF(t.loss_reason, ''''), ''(sem motivo registrado)'') = ANY(string_to_array(p_loss_reasons, '',''))',
    'public.fn_loss_filter_match(t.loss_reason_slug, t.loss_reason, p_loss_reasons)');

  -- (2) o agrupamento do bloco "Motivo de perda".
  -- min(slug) em vez de mexer no GROUP BY: rótulo e código são 1:1, e assim não preciso encostar
  -- num `GROUP BY 1` que aparece em vários pontos da função.
  if position('SELECT COALESCE(NULLIF(o.loss_reason, ''''), ''(sem motivo registrado)'') AS reason, COUNT(*) AS cnt' in v_src) = 0 then
    raise exception 'agrupamento de motivo nao encontrado no dashboard';
  end if;
  v_src := replace(v_src,
    'SELECT COALESCE(NULLIF(o.loss_reason, ''''), ''(sem motivo registrado)'') AS reason, COUNT(*) AS cnt',
    'SELECT public.fn_loss_reason_label(p_clinic_id, o.loss_reason_slug, o.loss_reason) AS reason, min(o.loss_reason_slug) AS slug, COUNT(*) AS cnt');

  -- (3) o jsonb ganha o código, sem perder o rótulo
  if position('jsonb_build_object(''reason'', reason, ''count'', cnt)' in v_src) = 0 then
    raise exception 'jsonb de lossReasons nao encontrado';
  end if;
  v_src := replace(v_src,
    'jsonb_build_object(''reason'', reason, ''count'', cnt)',
    'jsonb_build_object(''reason'', reason, ''slug'', slug, ''count'', cnt)');

  execute v_src;

  -- ================================================= get_commercial_leads_impl
  select pg_get_functiondef(oid) into v_src
  from pg_proc where pronamespace='public'::regnamespace and proname='get_commercial_leads_impl';
  if v_src is null then raise exception 'get_commercial_leads_impl nao encontrada'; end if;

  select count(*) into v_n from regexp_matches(v_src,
    'COALESCE\(NULLIF\(t[34]\.loss_reason, ''''\), ''\(sem motivo registrado\)''\) = ANY\(string_to_array\(p_loss_reasons, '',''\)\)', 'g');
  if v_n <> 3 then raise exception 'esperava 3 filtros em leads_impl, achei %', v_n; end if;

  v_src := replace(v_src,
    'COALESCE(NULLIF(t3.loss_reason, ''''), ''(sem motivo registrado)'') = ANY(string_to_array(p_loss_reasons, '',''))',
    'public.fn_loss_filter_match(t3.loss_reason_slug, t3.loss_reason, p_loss_reasons)');
  v_src := replace(v_src,
    'COALESCE(NULLIF(t4.loss_reason, ''''), ''(sem motivo registrado)'') = ANY(string_to_array(p_loss_reasons, '',''))',
    'public.fn_loss_filter_match(t4.loss_reason_slug, t4.loss_reason, p_loss_reasons)');

  if v_src ~ 'COALESCE\(NULLIF\(t[34]\.loss_reason' then
    raise exception 'sobrou filtro antigo em leads_impl';
  end if;

  execute v_src;

  -- ================================================= marketing_loss_reasons_impl
  select pg_get_functiondef(oid) into v_src
  from pg_proc where pronamespace='public'::regnamespace and proname='marketing_loss_reasons_impl';
  if v_src is null then raise exception 'marketing_loss_reasons_impl nao encontrada'; end if;

  if position('coalesce(nullif(t.loss_reason, ''''), ''(sem motivo registrado)'') as loss_reason' in v_src) = 0 then
    raise exception 'agrupamento de motivo nao encontrado no marketing';
  end if;
  -- Agrupa pelo RÓTULO canônico: é o que junta "Preço alto" e "Preço" numa linha só na grade de
  -- campanha. O nome da coluna de retorno não muda (o hook do front mapeia por ele).
  v_src := replace(v_src,
    'coalesce(nullif(t.loss_reason, ''''), ''(sem motivo registrado)'') as loss_reason',
    'public.fn_loss_reason_label(p_clinic_id, t.loss_reason_slug, t.loss_reason) as loss_reason');

  execute v_src;
end
$mig$;

