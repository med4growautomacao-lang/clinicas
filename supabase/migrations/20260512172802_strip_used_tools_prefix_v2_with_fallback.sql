-- 20260512172802_strip_used_tools_prefix_v2_with_fallback
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.strip_used_tools_prefix(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  depth int := 0;
  i int;
  c char(1);
  fallback_idx int;
BEGIN
  IF s IS NULL OR position('[Used tools:' IN s) <> 1 THEN
    RETURN s;
  END IF;

  -- Tentativa 1: depth counting (caso ideal — brackets balanceados)
  FOR i IN 1..length(s) LOOP
    c := substring(s FROM i FOR 1);
    IF c = '[' THEN
      depth := depth + 1;
    ELSIF c = ']' THEN
      depth := depth - 1;
      IF depth = 0 THEN
        RETURN ltrim(substring(s FROM i + 1));
      END IF;
    END IF;
  END LOOP;

  -- Fallback: procurar o padrão "]]" (fim do array Result + fim do wrapper Used tools)
  -- seguido de espaço, quebra de linha ou emoji/texto natural
  fallback_idx := position(']] ' IN s);
  IF fallback_idx > 0 THEN
    RETURN ltrim(substring(s FROM fallback_idx + 2));
  END IF;
  fallback_idx := position(E']]\n' IN s);
  IF fallback_idx > 0 THEN
    RETURN ltrim(substring(s FROM fallback_idx + 2));
  END IF;

  -- Último recurso: retorna o texto original (não conseguiu identificar onde fecha)
  RETURN s;
END;
$$;
