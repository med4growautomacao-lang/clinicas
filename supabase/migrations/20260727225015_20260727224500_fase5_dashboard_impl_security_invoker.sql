-- 20260727225015_20260727224500_fase5_dashboard_impl_security_invoker
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 5 (hardening): alinha os 3 _impl de dashboard/commercial a SECURITY INVOKER, como os 6
-- marketing_*_impl já são. Sem mudança de comportamento hoje (só o wrapper DEFINER e o cron os
-- chamam, ambos como postgres, que tem bypassrls), mas é rede de proteção: se um GRANT futuro
-- reabrir EXECUTE de um _impl para authenticated (foi o vetor do incidente de 26/07), com INVOKER
-- a RLS ainda barra o chamador, enquanto com DEFINER o vazamento cross-tenant seria total.
alter function public.get_dashboard_stats_impl(uuid,date,date,text,text,text) security invoker;
alter function public.get_commercial_dashboard_impl(uuid,date,date,date,date,text,text,text,date,date,text,text) security invoker;
alter function public.get_commercial_leads_impl(uuid,date,date,date,date,text,text,integer,integer,text,text,date,date,text,text,text,text) security invoker;
