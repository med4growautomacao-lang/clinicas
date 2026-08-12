-- 20260720042608_ai_loop_guard_text_overload
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- HOTFIX: ai_turn_buffer.clinic_id chega como TEXT no getBufferFinal, então a chamada
-- vira fn_ai_loop_guard(text, text) e não casava com a assinatura (text, uuid).
-- Sobrecarga que converte clinic_id p/ uuid (fail-open se inválido) e delega à função real.
create or replace function public.fn_ai_loop_guard(
  p_session_id text,
  p_clinic_id  text,
  p_max_turns  int default 20,
  p_window_min int default 30
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cid uuid;
begin
  begin
    v_cid := nullif(btrim(p_clinic_id), '')::uuid;
  exception when others then
    v_cid := null;  -- clinic_id não-uuid não pode quebrar o turno
  end;
  return public.fn_ai_loop_guard(p_session_id, v_cid, p_max_turns, p_window_min);
end;
$$;
