-- 20260714034539_book_appointment_default_seguro
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- book_appointment: o DEFAULT passa a VALIDAR.
--
-- Estava: v_validate := COALESCE(p_validate_availability, (p_source='ia'));
-- Ou seja, SÓ a IA validava. Com p_source='manual' a RPC não checava NADA — comprovado em produção
-- (transação abortada, Lorena): o manual conseguiu marcar em segunda-feira SEM EXPEDIENTE, em DIA
-- DE FOLGA, às 03:00 da manhã, DENTRO de um bloqueio, e violando o buffer de 15 min.
--
-- Hoje isso não explode só porque a UI é bem-comportada (os formulários só oferecem horários vindos
-- de get_available_slots). Mas qualquer chamador fora da UI gravava por cima de tudo, em silêncio.
--
-- A irmã reschedule_appointment já fazia o certo: valida por padrão (p_force default false), e o app
-- opta por forçar EXPLICITAMENTE. book_appointment era o único com o default inseguro.
--
-- PRINCÍPIO: default seguro; forçar é explícito (p_validate_availability => false).
-- O bypass do AVISO MÍNIMO continua no manual (intencional: encaixe no mesmo dia).
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'book_appointment';

  d2 := replace(
    d,
    'v_validate := COALESCE(p_validate_availability, (p_source=''ia''));',
    'v_validate := COALESCE(p_validate_availability, true);'
  );

  if d2 = d then
    raise exception 'Linha do default nao encontrada — abortando para nao aplicar em falso.';
  end if;

  execute d2;
end $$;
