-- Adiciona run_hour_sp (hora fixa SP p/ a rodada diária) à config do agendador.
-- Em 1×/dia (every_hours>=24) a edge dispara ancorada nessa hora (SP), não em "24h desde o
-- último run"; garante horário previsível (default 05:00, madrugada = dia anterior já fechou).
CREATE OR REPLACE FUNCTION public.set_ad_spend_sync_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := coalesce((p_config->>'enabled')::boolean, false);
  v_every int := coalesce((p_config->>'every_hours')::int, 24);
  v_hour int := coalesce((p_config->>'run_hour_sp')::int, 5);
  v_look int := coalesce((p_config->>'lookback_days')::int, 1);
  v_batch int := coalesce((p_config->>'batch_size')::int, 300);
  v_platforms jsonb := coalesce(p_config->'platforms', '["meta_ads","google_ads"]'::jsonb);
  v_p text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_every < 1 OR v_every > 168 THEN RAISE EXCEPTION 'every_hours fora de 1..168'; END IF;
  IF v_hour < 0 OR v_hour > 23 THEN RAISE EXCEPTION 'run_hour_sp fora de 0..23'; END IF;
  IF v_look < 1 OR v_look > 30 THEN RAISE EXCEPTION 'lookback_days fora de 1..30'; END IF;
  IF v_batch < 1 OR v_batch > 2000 THEN RAISE EXCEPTION 'batch_size fora de 1..2000'; END IF;
  FOR v_p IN SELECT jsonb_array_elements_text(v_platforms) LOOP
    IF v_p NOT IN ('meta_ads','google_ads') THEN RAISE EXCEPTION 'plataforma inválida: %', v_p; END IF;
  END LOOP;

  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES (
    'ad_spend_sync_config',
    jsonb_build_object(
      'enabled', v_enabled, 'every_hours', v_every, 'run_hour_sp', v_hour,
      'lookback_days', v_look, 'platforms', v_platforms, 'batch_size', v_batch
    )::text,
    'Agendador de investimento: liga/desliga, intervalo (h), hora fixa SP, lookback (dias), plataformas, lote.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'ad_spend_sync_config');
END;
$$;
