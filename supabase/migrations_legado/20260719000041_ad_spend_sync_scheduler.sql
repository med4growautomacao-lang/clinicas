-- Agendador de sincronização de investimento (Meta + Google) — config + estado + cron.
-- Edge spend-sync-cron faz o trabalho; aqui moram a config (system_settings), a RPC de escrita
-- (super-admin) e o tick do pg_cron. enabled=false por padrão (go-live é flip deliberado).

-- Config (não-secreta; SELECT público ok — sem segredos aqui)
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'ad_spend_sync_config',
  '{"enabled":false,"every_hours":24,"lookback_days":1,"platforms":["meta_ads","google_ads"],"batch_size":300}',
  'Agendador de investimento: liga/desliga, intervalo (h), lookback (dias), plataformas, tamanho do lote.'
) ON CONFLICT (id) DO NOTHING;

-- Estado do sweep (cursor + último run completo)
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'ad_spend_sync_state',
  '{"last_run_at":null,"cursor":0}',
  'Estado do agendador de investimento (cursor + last_run_at).'
) ON CONFLICT (id) DO NOTHING;

-- Escrita da config (super-admin; valida)
CREATE OR REPLACE FUNCTION public.set_ad_spend_sync_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := coalesce((p_config->>'enabled')::boolean, false);
  v_every int := coalesce((p_config->>'every_hours')::int, 24);
  v_look int := coalesce((p_config->>'lookback_days')::int, 1);
  v_batch int := coalesce((p_config->>'batch_size')::int, 300);
  v_platforms jsonb := coalesce(p_config->'platforms', '["meta_ads","google_ads"]'::jsonb);
  v_p text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_every < 1 OR v_every > 168 THEN RAISE EXCEPTION 'every_hours fora de 1..168'; END IF;
  IF v_look < 1 OR v_look > 30 THEN RAISE EXCEPTION 'lookback_days fora de 1..30'; END IF;
  IF v_batch < 1 OR v_batch > 2000 THEN RAISE EXCEPTION 'batch_size fora de 1..2000'; END IF;
  FOR v_p IN SELECT jsonb_array_elements_text(v_platforms) LOOP
    IF v_p NOT IN ('meta_ads','google_ads') THEN RAISE EXCEPTION 'plataforma inválida: %', v_p; END IF;
  END LOOP;

  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES (
    'ad_spend_sync_config',
    jsonb_build_object(
      'enabled', v_enabled, 'every_hours', v_every, 'lookback_days', v_look,
      'platforms', v_platforms, 'batch_size', v_batch
    )::text,
    'Agendador de investimento: liga/desliga, intervalo (h), lookback (dias), plataformas, tamanho do lote.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'ad_spend_sync_config');
END;
$$;
REVOKE ALL ON FUNCTION public.set_ad_spend_sync_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ad_spend_sync_config(jsonb) TO authenticated;

-- Tick do cron a cada 15 min. A edge decide se "está na hora" (every_hours) e varre em lotes.
select cron.schedule(
  'spend_sync_cron',
  '*/15 * * * *',
  $$ select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/spend-sync-cron'); $$
);
