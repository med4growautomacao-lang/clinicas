-- 20260811042617_20260811011500_conserta_alerta_e_custo_do_rotulo
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Dois consertos apontados no code-review do commit 1bf9b4c.

do $mig$
declare v_src text; v_n int;
begin
  -- ================================================================ (1) alerta que nunca acendia
  -- finalize_ticket chamava log_system_error com 5 argumentos posicionais, mas a função tem UMA
  -- assinatura: (p_scope, p_code, p_title, p_level, p_clinic_id, p_context, p_is_monitor). Não há
  -- cast implícito de uuid para text, então a chamada nem resolvia (42883) — e o
  -- `exception when others then null` logo abaixo engolia o erro.
  -- Resultado: `motivo_perda_sem_catalogo` era impossível de existir, e o monitor perda_sem_motivo
  -- manda o dono conferir justamente esse alerta. Rede furada; hoje ainda não passou peixe
  -- (0 tickets com texto sem tradução), mas o laço de auto-conserto do catálogo estava morto.
  select pg_get_functiondef(oid) into v_src
  from pg_proc where pronamespace='public'::regnamespace and proname='finalize_ticket';

  if position('''motivo_perda_sem_catalogo'',' in v_src) = 0 then
    raise exception 'chamada do alerta nao encontrada em finalize_ticket';
  end if;

  v_src := replace(v_src,
    'PERFORM public.log_system_error(
        ''motivo_perda_sem_catalogo'',
        ''Motivo de perda sem tradução no catálogo: '' || left(p_loss_reason, 120),
        ''warning'',
        v_ticket.clinic_id,
        jsonb_build_object(''loss_reason'', p_loss_reason, ''ticket_id'', p_ticket_id)
      );',
    'PERFORM public.log_system_error(
        ''finalize_ticket'',
        ''motivo_perda_sem_catalogo'',
        ''Motivo de perda sem tradução no catálogo: '' || left(p_loss_reason, 120),
        ''warning'',
        v_ticket.clinic_id,
        jsonb_build_object(''loss_reason'', p_loss_reason, ''ticket_id'', p_ticket_id),
        false
      );');

  if v_src ~ 'log_system_error\(\s*''motivo_perda_sem_catalogo''' then
    raise exception 'a troca da chamada do alerta nao aconteceu';
  end if;

  execute v_src;

  -- ================================================================ (2) rótulo resolvido por LINHA
  -- fn_loss_reason_label é SECURITY DEFINER e executa fn_clinic_loss_reasons (3 joins) a cada
  -- chamada. No SELECT com GROUP BY 1 ela rodava uma vez POR TICKET PERDIDO: medido 28,8 ms ->
  -- 1.695 ms no bloco (59x) na maior clínica, com o painel inteiro em ~2,2 s contra teto de 8 s.
  -- É o mesmo eixo do incidente de 06/08 (timeout que parece lentidão).
  -- Conserto: agrupar pelo SLUG (barato) e resolver o rótulo uma vez por grupo, no máximo 16 vezes.
  select pg_get_functiondef(oid) into v_src
  from pg_proc where pronamespace='public'::regnamespace and proname='get_commercial_dashboard_impl';

  if position('SELECT public.fn_loss_reason_label(p_clinic_id, o.loss_reason_slug, o.loss_reason) AS reason, min(o.loss_reason_slug) AS slug, COUNT(*) AS cnt' in v_src) = 0 then
    raise exception 'bloco de agrupamento de motivo nao encontrado';
  end if;

  v_src := replace(v_src,
    'SELECT public.fn_loss_reason_label(p_clinic_id, o.loss_reason_slug, o.loss_reason) AS reason, min(o.loss_reason_slug) AS slug, COUNT(*) AS cnt',
    'SELECT COALESCE(o.loss_reason_slug, ''(sem motivo registrado)'') AS slug, min(o.loss_reason) AS texto, COUNT(*) AS cnt');

  if position('jsonb_build_object(''reason'', reason, ''slug'', slug, ''count'', cnt)' in v_src) = 0 then
    raise exception 'jsonb de lossReasons nao encontrado';
  end if;

  v_src := replace(v_src,
    'jsonb_build_object(''reason'', reason, ''slug'', slug, ''count'', cnt)',
    'jsonb_build_object(''reason'', public.fn_loss_reason_label(p_clinic_id, nullif(slug, ''(sem motivo registrado)''), texto), ''slug'', nullif(slug, ''(sem motivo registrado)''), ''count'', cnt)');

  execute v_src;
end
$mig$;
