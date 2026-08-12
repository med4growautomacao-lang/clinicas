-- 20260729212001_20260724438000_preview_finish_respects_optout
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O ramo finish_* do preview conta tickets por conta própria (não passa pelos geradores), então sem
-- isto a tela mostraria no histórico gente que já não recebe mais (preview mentindo).
-- Substituição PROGRAMÁTICA na única âncora, com trava: se a âncora não existir, a migração falha em
-- vez de aplicar algo diferente do esperado. Só o corpo muda; assinatura preservada por construção.
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'preview_followup_activation';

  IF v_def IS NULL THEN RAISE EXCEPTION 'preview_followup_activation nao encontrada'; END IF;

  v_new := replace(v_def,
    'and coalesce(l.followup_enabled, true) = true',
    'and coalesce(l.followup_enabled, true) = true' || E'\n' ||
    '       and not exists (select 1 from lead_followup_optout o' || E'\n' ||
    '                        where o.lead_id = l.id and o.kind = p_kind)');

  IF v_new = v_def THEN RAISE EXCEPTION 'ancora do gate do lead nao encontrada: nada foi alterado'; END IF;

  EXECUTE v_new;
END $$;
