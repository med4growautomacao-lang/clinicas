-- Cancelar/pular o evento CAPI de um ticket, a partir do modal de Atribuição Meta.
-- meta_capi_events tem RLS (só super admin lê; escrita é service_role), então o front não mexe direto.
--   p_delete=false (Pular): mantém a conversão no funil, só marca o evento como 'skipped' (não envia).
--   p_delete=true (Fechar/desfazer): apaga a linha (a conversão foi revertida) — e como o índice único
--     é por ticket, apagar permite reenfileirar caso o lead volte à etapa de conversão depois.
create or replace function public.cancel_meta_capi_event(p_ticket_id uuid, p_delete boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.tickets where id = p_ticket_id;
  if v_clinic is null then return; end if;
  if not (public.is_clinic_admin(v_clinic) or public.is_super_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_delete then
    delete from public.meta_capi_events
     where ticket_id = p_ticket_id and status in ('pending', 'skipped', 'error');
  else
    update public.meta_capi_events
       set status = 'skipped', last_error = 'pulado pelo usuário'
     where ticket_id = p_ticket_id and status = 'pending';
  end if;
end;
$$;
revoke all on function public.cancel_meta_capi_event(uuid, boolean) from public, anon;
grant execute on function public.cancel_meta_capi_event(uuid, boolean) to authenticated;
