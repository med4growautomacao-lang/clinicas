-- Status de migração para o hub (painel Super Admin › Migração Hub). Super-admin only.
-- Lista clínicas com rota (n8n|hub), conexão, IA e volume 7d — alimenta o HubMigrationPanel.
-- A migração em si é feita pela action 'migrate' do whatsapp-orchestrator.
create or replace function public.get_hub_migration_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
stable
as $$
declare v_res jsonb;
begin
  if not is_super_admin() then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x order by (x->>'route') desc, (x->>'msgs_7d')::int desc), '[]'::jsonb)
    into v_res
  from (
    select jsonb_build_object(
      'clinic_id', c.id,
      'name', c.name,
      'category', c.category,
      'route', coalesce(wi.inbound_route, 'n8n'),
      'status', coalesce(wi.status, 'disconnected'),
      'ia', coalesce(ac.auto_schedule, false),
      'has_token', (nullif(btrim(wi.api_token), '') is not null),
      'msgs_7d', coalesce(m.n, 0)
    ) as x
    from whatsapp_instances wi
    join clinics c on c.id = wi.clinic_id
    left join ai_config ac on ac.clinic_id = c.id
    left join lateral (
      select count(*) as n from chat_messages cm
      where cm.clinic_id = c.id
        and cm.created_at > (now() at time zone 'America/Sao_Paulo') - interval '7 days'
    ) m on true
    where wi.clinic_id is not null
  ) t;
  return v_res;
end;
$$;

revoke all on function public.get_hub_migration_status() from public, anon;
grant execute on function public.get_hub_migration_status() to authenticated;
