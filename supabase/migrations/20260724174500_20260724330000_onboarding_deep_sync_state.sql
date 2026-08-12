-- 20260724174500_20260724330000_onboarding_deep_sync_state
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Estado do deep-sync 90 dias. Job por clínica + progresso por chat.
CREATE TABLE IF NOT EXISTS public.onboarding_deep_sync (
  clinic_id      uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending',   -- pending | running | done | error
  target_cutoff  timestamptz NOT NULL,              -- now() - 90d na criação
  oldest_reached timestamptz,                        -- msg mais antiga já importada (clínica)
  rounds         int NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_deep_sync_chat (
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  chatid      text NOT NULL,                         -- JID (wa_chatid @s.whatsapp.net)
  phone_norm  text,
  oldest_ts   timestamptz,                           -- oldest importado desse chat na última observação
  fires       int NOT NULL DEFAULT 0,
  done        boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, chatid)
);
CREATE INDEX IF NOT EXISTS idx_deep_sync_chat_pending ON public.onboarding_deep_sync_chat (clinic_id) WHERE NOT done;

ALTER TABLE public.onboarding_deep_sync      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_deep_sync_chat ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso só via RPCs SECURITY DEFINER (start/status/tick), que já checam fn_can_onboard.

-- Enfileira/reseta o job de deep-sync (90 dias) da clínica.
CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_start(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  DELETE FROM onboarding_deep_sync_chat WHERE clinic_id = p_clinic_id;
  INSERT INTO onboarding_deep_sync (clinic_id, status, target_cutoff, oldest_reached, rounds, last_error, updated_at)
  VALUES (p_clinic_id, 'pending', now() - interval '90 days', NULL, 0, NULL, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET status='pending', target_cutoff = now() - interval '90 days', oldest_reached=NULL,
        rounds=0, last_error=NULL, updated_at=now();
  RETURN jsonb_build_object('success', true);
END; $function$;

-- Progresso do deep-sync para a UI.
CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_status(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v onboarding_deep_sync%rowtype; v_total int; v_done int; v_pct int;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('exists', false); END IF;
  SELECT * INTO v FROM onboarding_deep_sync WHERE clinic_id = p_clinic_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('exists', false); END IF;
  SELECT count(*), count(*) FILTER (WHERE done) INTO v_total, v_done FROM onboarding_deep_sync_chat WHERE clinic_id = p_clinic_id;
  v_pct := CASE
    WHEN v.status = 'done' THEN 100
    WHEN v.oldest_reached IS NULL THEN 0
    ELSE LEAST(100, GREATEST(0, round(100.0 * extract(epoch FROM (now() - v.oldest_reached))
                                          / NULLIF(extract(epoch FROM (now() - v.target_cutoff)), 0))::numeric)::int)
  END;
  RETURN jsonb_build_object('exists', true, 'status', v.status, 'rounds', v.rounds,
    'target_cutoff', v.target_cutoff, 'oldest_reached', v.oldest_reached,
    'chats_total', v_total, 'chats_done', v_done, 'percent', v_pct, 'last_error', v.last_error,
    'updated_at', v.updated_at);
END; $function$;
