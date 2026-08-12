-- 20260720184926_meta_capi_conversions_scheduler
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Agendador da API de Conversoes CAPI (CTWA). A edge meta-capi-conversions faz o trabalho;
-- aqui moram a config (system_settings), a RPC de escrita (super-admin) e o tick do pg_cron.

INSERT INTO public.system_settings (id, value, description)
VALUES (
  'meta_capi_config',
  '{"enabled":false,"batch_size":25}',
  'API de Conversoes CAPI (CTWA): liga/desliga e tamanho do lote por execucao.'
) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_meta_capi_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := coalesce((p_config->>'enabled')::boolean, false);
  v_batch   int     := coalesce((p_config->>'batch_size')::int, 25);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_batch < 1 OR v_batch > 500 THEN
    RAISE EXCEPTION 'batch_size fora de 1..500';
  END IF;

  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES (
    'meta_capi_config',
    jsonb_build_object('enabled', v_enabled, 'batch_size', v_batch)::text,
    'API de Conversoes CAPI (CTWA): liga/desliga e tamanho do lote por execucao.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'meta_capi_config');
END;
$$;
REVOKE ALL ON FUNCTION public.set_meta_capi_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_meta_capi_config(jsonb) TO authenticated;

select cron.unschedule('meta_capi_conversions')
 where exists (select 1 from cron.job where jobname = 'meta_capi_conversions');

select cron.schedule(
  'meta_capi_conversions',
  '*/2 * * * *',
  $$ select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/meta-capi-conversions'); $$
);
