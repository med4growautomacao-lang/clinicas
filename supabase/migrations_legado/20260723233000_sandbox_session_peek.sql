-- Devolve o session_id da sessao de simulacao (clinica+usuario) SEM criar nada. A tela usa no mount
-- para recarregar a conversa ao voltar para a aba (o session_id e derivado no servidor: clinic_phone
-- + telefone ficticio; o cliente nao consegue calcular). Mesma formula do sandbox_send.
create or replace function public.sandbox_session(p_clinic_id uuid, p_user_id uuid)
returns text language plpgsql stable security definer set search_path to 'public'
as $$
declare v_clinic_phone text;
begin
  select phone_number into v_clinic_phone from public.whatsapp_instances
   where clinic_id = p_clinic_id order by (status = 'connected') desc nulls last limit 1;
  return coalesce(nullif(v_clinic_phone,''), 'sandbox') || public._sandbox_phone(p_clinic_id, p_user_id);
end $$;

revoke all on function public.sandbox_session(uuid,uuid) from anon, authenticated;
