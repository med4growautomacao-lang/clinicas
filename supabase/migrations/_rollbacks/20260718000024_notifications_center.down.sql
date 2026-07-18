-- Rollback de 20260718000024_notifications_center.sql
do $$
begin
  begin
    alter publication supabase_realtime drop table public.notifications;
  exception when others then null;
  end;
end $$;

drop function if exists public.mark_notifications_read(uuid, uuid[]);
drop function if exists public.notify_ops(uuid,text,text,text,text,uuid,uuid,uuid,text,jsonb,boolean,text);
drop table if exists public.notifications;
