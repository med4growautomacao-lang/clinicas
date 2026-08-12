-- 20260722005345_harden_stage_delete_guard_and_conv_ai_acl
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Correções da revisão de código sobre 20260721000021 e 20260721000023.

-- 1) O guard falhava ABERTO: era SECURITY INVOKER e decidia olhando public.clinics sob RLS. Quem
--    não enxergasse a linha da clínica faria o EXISTS devolver false e conseguiria apagar a etapa
--    de sistema, justamente o que a trigger existe para impedir. Guard de invariante falha FECHADO.
create or replace function public.fn_block_system_stage_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
BEGIN
  IF OLD.is_system AND EXISTS (SELECT 1 FROM public.clinics WHERE id = OLD.clinic_id) THEN
    RAISE EXCEPTION 'A etapa "%" é uma etapa de sistema e não pode ser excluída. Use o botão de ocultar (olho) na configuração de funil.', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

revoke all on function public.fn_block_system_stage_delete() from public, anon, authenticated;

-- 2) Reafirma a ACL de conv_ai_get_context, que a 20260721000023 tinha deixado de declarar.
revoke all on function public.conv_ai_get_context(uuid, int) from public, anon, authenticated;
grant execute on function public.conv_ai_get_context(uuid, int) to service_role;
