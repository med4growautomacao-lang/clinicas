-- Agendador da API de Conversões CAPI (CTWA). A edge meta-capi-conversions faz o trabalho;
-- aqui moram a config (system_settings), a RPC de escrita (super-admin) e o tick do pg_cron.
-- enabled=false por padrão — go-live é flip deliberado (a edge respeita o gate).

-- Config (não-secreta; SELECT público de system_settings é ok — sem segredos aqui).
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'meta_capi_config',
  '{"enabled":false,"batch_size":25}',
  'API de Conversões CAPI (CTWA): liga/desliga e tamanho do lote por execução.'
) ON CONFLICT (id) DO NOTHING;

-- Escrita da config (super-admin; valida). Mesmo molde de set_ad_spend_sync_config.
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
    'API de Conversões CAPI (CTWA): liga/desliga e tamanho do lote por execução.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'meta_capi_config');
END;
$$;
REVOKE ALL ON FUNCTION public.set_meta_capi_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_meta_capi_config(jsonb) TO authenticated;

-- Tick do cron a cada 2 min. A edge decide o que enviar (gate `enabled` + lote de pendentes).
-- system_http_post, nunca net.http_post cru (regra do CLAUDE.md: saber QUAL URL falhou).
select cron.unschedule('meta_capi_conversions')
 where exists (select 1 from cron.job where jobname = 'meta_capi_conversions');

select cron.schedule(
  'meta_capi_conversions',
  '*/2 * * * *',
  $$ select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/meta-capi-conversions'); $$
);
