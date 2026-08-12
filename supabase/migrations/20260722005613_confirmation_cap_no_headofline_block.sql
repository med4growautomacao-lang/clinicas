-- 20260722005613_confirmation_cap_no_headofline_block
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O cap por clínica (5/rodada) somado ao `continue` do loop criava bloqueio de fila: consulta sem
-- telefone válido (ou clínica sem token) era escolhida, pulada sem marcar reminder_sent_at, e
-- reescolhida na rodada seguinte, ocupando o slot para sempre. 5 dessas travavam TODOS os lembretes
-- da clínica até as consultas passarem do horário. Antes do cap o loop varria tudo e não travava.
-- Fix: linha não enviável nem entra na seleção. O `continue` fica como cinto e suspensório.
do $mig$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'process_confirmation_reminders' and pronamespace = 'public'::regnamespace;

  if position('normalize_br_phone(p.phone) is not null' in src) = 0 then
    src := replace(
      src,
      $old$        and coalesce(l.followup_enabled, true) = true$old$,
      $new$        and coalesce(l.followup_enabled, true) = true
        and normalize_br_phone(p.phone) is not null
        and wa.api_token is not null and btrim(wa.api_token) <> ''$new$
    );
    execute src;
  end if;
end $mig$;
