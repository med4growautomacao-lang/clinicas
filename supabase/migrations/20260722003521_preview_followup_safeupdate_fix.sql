-- 20260722003521_preview_followup_safeupdate_fix
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- A RPC de preview limpava a temp table com "delete from _fu_prev;" (sem WHERE). Na sessão do
-- PostgREST o safe-updates está ligado e recusa DELETE sem WHERE ("DELETE requires a WHERE clause"),
-- então a janela de ativação quebrava para o usuário final (mas funcionava no service role, por isso
-- passou nos testes). TRUNCATE não é afetado por esse guard.
-- Replace cirúrgico no corpo da função (não reescreve as ~200 linhas, não altera nenhuma lógica).
do $$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
    where proname = 'preview_followup_activation' and pronamespace = 'public'::regnamespace;

  if position('delete from _fu_prev;' in src) > 0 then
    execute replace(src, 'delete from _fu_prev;', 'truncate table _fu_prev;');
  end if;
end $$;
