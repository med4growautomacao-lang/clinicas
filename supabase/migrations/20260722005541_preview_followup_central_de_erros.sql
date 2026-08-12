-- 20260722005541_preview_followup_central_de_erros
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona o bloco de exceção da Central de Erros à RPC de preview, sem reescrever as ~200 linhas.
-- Replace cirúrgico (mesmo padrão da migration 059). Idempotente: só age se ainda não tiver o log.
do $mig$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'preview_followup_activation' and pronamespace = 'public'::regnamespace;

  if position('log_system_error' in src) = 0 then
    src := replace(
      src,
      $old$  );
end;
$function$$old$,
      $new$  );
exception when others then
  if sqlstate <> 'P0001' then
    perform log_system_error('followup-preview','preview_failed',
      'Falha ao calcular o preview de ativação de follow-up','error', p_clinic_id,
      jsonb_build_object('kind', p_kind, 'sqlstate', sqlstate, 'detail', sqlerrm), false);
  end if;
  raise;
end;
$function$$new$
    );
    execute src;
  end if;
end $mig$;
