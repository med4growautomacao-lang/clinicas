-- 20260727224430_20260727224200_fase4a_delete_clinic_member_guarded
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 4a: conserta a feature "excluir membro" (TeamManagement), quebrada porque 20260727163000
-- revogou authenticated de delete_user_full (corretamente: ela apaga auth.users/clinic_users/
-- org_users/prontuario_passwords SEM guard). A correção é um WRAPPER guardado, não um re-grant.
--
-- Autoriza: super-admin, OU quem gerencia a clínica do alvo, OU quem gerencia a org do alvo.
create or replace function public.delete_clinic_member(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_clinic uuid;
  v_org uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('success', false, 'error_code', 'missing_user');
  end if;
  if p_user_id = auth.uid() then
    raise exception 'não é possível remover o próprio acesso' using errcode = '42501';
  end if;

  select clinic_id into v_clinic from public.clinic_users where id = p_user_id;
  select organization_id into v_org from public.org_users where user_id = p_user_id limit 1;

  if not (
    public.is_super_admin()
    or (v_clinic is not null and public.can_manage_clinic(v_clinic))
    or (v_org is not null and public.can_manage_org(v_org))
  ) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  return public.delete_user_full(p_user_id);
end;
$function$;

revoke all on function public.delete_clinic_member(uuid) from public, anon;
grant execute on function public.delete_clinic_member(uuid) to authenticated, service_role;
