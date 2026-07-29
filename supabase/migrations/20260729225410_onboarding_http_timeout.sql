-- PRODUÇÃO (29/07): o deep-sync da Lorena ficou 'error' com "Operation timed out after 5000
-- milliseconds with 360448 bytes received" (45 rodadas seguidas) e o import pelo botão falhou 3x com
-- "SSL connection timeout".
--
-- CAUSA MEDIDA: a extensão `http` usa timeout DEFAULT de 5s e o import leva **5174 ms** nessa clínica
-- (/message/find com limit 8000). Ou seja, estourava por pouco, o que explica a falha intermitente.
-- O histórico parava de avançar em silêncio: só a Central mostrava, o operador não via nada.
--
-- Só estas 2 funções usam a extensão `http` neste banco (conferido em pg_proc), então ajustar o
-- CURLOPT é seguro e não precisa de reset: não há outro chamador para afetar.
--
-- ⚠️ O timeout LONGO vale só para as leituras grandes (/chat/find e /message/find). Dentro do laço
-- que dispara /message/history-sync ele volta para 5s: são até 20 chamadas por rodada e, com 25s
-- cada, uma uazapi travada bloquearia ~500s, muito além do cron de 2 min.
--
-- Âncoras: usamos as próprias chamadas/linhas cujo texto é IDÊNTICO em produção e no arquivo de
-- consolidação do repo. Um comentário seria âncora mais legível, mas o texto divergiu entre os dois
-- ("DISPARA" x "dispara") e esta migração falharia num banco novo. A primeira tentativa falhou
-- exatamente assim, e falhou ALTO (RAISE) em vez de aplicar pela metade — é o comportamento desejado.
DO $$
DECLARE
  r record; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- leituras grandes: 25s
      ('_onboarding_import_run',
       'PERFORM set_config(''app.onboarding_import'', ''on'', true);',
       'PERFORM http_set_curlopt(''CURLOPT_TIMEOUT_MS'', ''25000'');'),
      ('onboarding_deep_sync_tick',
       'PERFORM set_config(''app.onboarding_import'',''on'',true);',
       'PERFORM http_set_curlopt(''CURLOPT_TIMEOUT_MS'', ''25000'');')
    ) AS s(fn, ancora, linha)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = r.fn;
    IF v_def IS NULL THEN RAISE EXCEPTION 'timeout: função % não encontrada', r.fn; END IF;
    IF position(r.linha in v_def) > 0 THEN CONTINUE; END IF;   -- idempotente
    IF position(r.ancora in v_def) = 0 THEN
      RAISE EXCEPTION 'timeout: âncora não encontrada em % (%)', r.fn, r.ancora;
    END IF;
    v_new := replace(v_def, r.ancora, r.ancora || E'\n      ' || r.linha);
    EXECUTE v_new;
  END LOOP;

  -- disparos do history-sync: volta para 5s (dentro do laço, antes da chamada)
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'onboarding_deep_sync_tick';
  IF position('''CURLOPT_TIMEOUT_MS'', ''5000''' in v_def) = 0 THEN
    IF position('PERFORM http((''POST'', ''https://med4growautomacao.uazapi.com/message/history-sync''' in v_def) = 0 THEN
      RAISE EXCEPTION 'timeout: âncora do history-sync não encontrada no tick';
    END IF;
    v_new := replace(v_def,
      'PERFORM http((''POST'', ''https://med4growautomacao.uazapi.com/message/history-sync''',
      'PERFORM http_set_curlopt(''CURLOPT_TIMEOUT_MS'', ''5000'');' || E'\n          ' ||
      'PERFORM http((''POST'', ''https://med4growautomacao.uazapi.com/message/history-sync''');
    EXECUTE v_new;
  END IF;
END $$;

-- Trava de conferência: import com 1 ajuste, tick com os DOIS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='_onboarding_import_run'
                    AND p.prosrc LIKE '%CURLOPT_TIMEOUT_MS%') THEN
    RAISE EXCEPTION 'timeout: _onboarding_import_run ficou sem o ajuste';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(
        (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='onboarding_deep_sync_tick'),
        'CURLOPT_TIMEOUT_MS', 'g')) <> 2 THEN
    RAISE EXCEPTION 'timeout: o tick precisa dos DOIS ajustes (25s nas leituras, 5s nos disparos)';
  END IF;
END $$;

-- Retoma o job que ficou preso em 'error' por causa do timeout (Lorena).
UPDATE public.onboarding_deep_sync
   SET status = 'pending', last_error = NULL, updated_at = now()
 WHERE status = 'error'
   AND last_error ILIKE '%timed out%';
