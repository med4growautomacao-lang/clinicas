-- ============================================================================================
-- Opt-out de follow-up POR LEAD E POR TIPO — consolidação
-- ============================================================================================
-- CONTEXTO: esta feature foi aplicada em 29/07/2026 via MCP (apply_migration) em 9 passos, e os
-- arquivos não foram gerados no repo na hora — erro meu. Este arquivo repõe a história no repo.
-- O nome usa a VERSÃO REAL registrada do primeiro passo (20260729204849), então:
--   • em produção é IGNORADO (a versão já consta em supabase_migrations.schema_migrations);
--   • num banco novo roda na posição cronológica correta, antes do arquivo de arquivamento
--     (20260729221106), que depende da tabela criada aqui.
--
-- Passos originais consolidados (rótulos como foram aplicados):
--   20260724430000_lead_followup_optout_table      -> version 20260729204849
--   20260724431000_set_lead_followup_optout_rpc    -> version 20260729204904
--   20260724432000_reengagement_respects_optout    -> version 20260729204933
--   20260724433000_confirmation_respects_optout    -> version 20260729211746
--   20260724434000_appt_reminder_respects_optout   -> version 20260729211800
--   20260724435000_pos_followup_respects_optout    -> version 20260729211825
--   20260724436000_welcome_respects_optout         -> version 20260729211845
--   20260724437000_finish_message_respects_optout  -> version 20260729211928
--   20260724438000_preview_finish_respects_optout  -> version 20260729212001
--
-- DUAS SEMÂNTICAS, de propósito (não unificar):
--   leads.followup_enabled  = interruptor MESTRE do contato ("não recebe NADA"). É o que o cadeado
--                             human_only, o "não é lead" e o onboarding querem dizer.
--   lead_followup_optout    = exceção por TIPO. Linha = "não manda ESTE tipo para ESTE lead".
-- A coluna NÃO foi dropada: 9.743 leads (30%) estão com ela false em 26 clínicas e o MOTIVO não foi
-- gravado, então migrar exigiria adivinhar quais tipos desligar para cada um.
-- ============================================================================================

-- 1) Tabela de exceções -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_followup_optout (
  clinic_id  uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id    uuid NOT NULL REFERENCES public.leads(id)   ON DELETE CASCADE,
  kind       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  reason     text,
  PRIMARY KEY (lead_id, kind),
  -- Vocabulário FECHADO: kind digitado errado nunca casaria e o opt-out não funcionaria em
  -- silêncio (fail-open). Espelha o tipo FollowupKind de src/lib/followupKinds.ts.
  CONSTRAINT chk_lfo_kind CHECK (kind IN (
    'welcome','reengagement','confirmation','appt_reminder',
    'pos_ganho','pos_perdido','finish_ganho','finish_perdido','finish_service'))
);

CREATE INDEX IF NOT EXISTS idx_lfo_clinic ON public.lead_followup_optout(clinic_id);

ALTER TABLE public.lead_followup_optout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_followup_optout_select ON public.lead_followup_optout;
CREATE POLICY lead_followup_optout_select ON public.lead_followup_optout
  FOR SELECT USING (
    clinic_id IN (SELECT public.my_clinic_ids()) OR (SELECT public.is_super_admin())
  );

-- ⚠️ ACL default de TABELA já vazou CRUD para anon neste projeto: fecha explicitamente.
REVOKE ALL ON TABLE public.lead_followup_optout FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.lead_followup_optout TO authenticated;
GRANT ALL    ON TABLE public.lead_followup_optout TO service_role;

COMMENT ON TABLE public.lead_followup_optout IS
  'Exceções de follow-up por lead e por tipo (kind). Linha = NÃO enviar aquele tipo. Complementa, não substitui, leads.followup_enabled (interruptor mestre do lead) nem as chaves de ai_config (gate da clínica).';

-- 2) Escrita (só via RPC; a tabela não tem INSERT/DELETE para authenticated) -------------------
CREATE OR REPLACE FUNCTION public.set_lead_followup_optout(
  p_lead_id uuid, p_kind text, p_off boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_clinic FROM leads WHERE id = p_lead_id;
  IF v_clinic IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'lead_not_found'); END IF;

  -- Guard igual ao de preview_followup_activation: é o mesmo público que opera o mesmo modal.
  IF NOT (
      is_super_admin()
      OR is_clinic_admin(v_clinic)
      OR EXISTS (SELECT 1 FROM clinic_users cu WHERE cu.id = auth.uid() AND cu.clinic_id = v_clinic)
      OR EXISTS (SELECT 1 FROM clinics c JOIN org_users ou ON ou.organization_id = c.organization_id
                 WHERE c.id = v_clinic AND ou.user_id = auth.uid())
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_off THEN
    INSERT INTO lead_followup_optout (clinic_id, lead_id, kind, created_by, reason)
    VALUES (v_clinic, p_lead_id, p_kind, auth.uid(), p_reason)
    ON CONFLICT (lead_id, kind) DO NOTHING;
  ELSE
    DELETE FROM lead_followup_optout WHERE lead_id = p_lead_id AND kind = p_kind;
  END IF;

  RETURN jsonb_build_object('success', true, 'lead_id', p_lead_id, 'kind', p_kind, 'off', p_off);
EXCEPTION WHEN OTHERS THEN
  -- CHECK violado (kind inválido) cai aqui: sem Central, o opt-out "não funciona" sem ninguém saber.
  PERFORM log_system_error('followup-optout', 'set_optout_failed',
    'Falha ao gravar opt-out de follow-up do lead', 'error', v_clinic,
    jsonb_build_object('lead_id', p_lead_id, 'kind', p_kind, 'off', p_off, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;

REVOKE ALL ON FUNCTION public.set_lead_followup_optout(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_followup_optout(uuid, text, boolean, text) TO authenticated, service_role;

-- 3) Os 7 pontos de envio passam a respeitar o opt-out ----------------------------------------
-- Aplicado por INJEÇÃO na âncora de cada função, e não recriando o corpo inteiro, de propósito:
-- copiar o corpo aqui congelaria a versão de hoje e, num rebuild, DESFARIA silenciosamente
-- qualquer correção que outra sessão tenha feito nessas funções depois. A injeção preserva o
-- corpo e só acrescenta a cláusula. Se a âncora não existir, a migração FALHA (alto e claro)
-- em vez de deixar um motor sem o opt-out — que é a falha silenciosa que queremos evitar.
DO $$
DECLARE
  r record;
  v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- função, âncora (linha existente), cláusula injetada logo abaixo
      ('fn_followup_candidates_reengagement',
       'and l.followup_enabled = true',
       'and not exists (select 1 from lead_followup_optout o where o.lead_id = l.id and o.kind = ''reengagement'')'),
      ('fn_followup_candidates_confirmation',
       'and coalesce(l.followup_enabled, true) = true',
       'and not exists (select 1 from lead_followup_optout o where o.lead_id = l.id and o.kind = ''confirmation'')'),
      ('fn_followup_candidates_appt_reminder',
       'and coalesce(l.followup_enabled, true) = true',
       'and not exists (select 1 from lead_followup_optout o where o.lead_id = l.id and o.kind = ''appt_reminder'')'),
      -- pos serve ganho E perdido na mesma consulta: o kind vem do desfecho
      ('fn_followup_candidates_pos',
       'and coalesce(l.followup_enabled, true) = true',
       'and not exists (select 1 from lead_followup_optout o where o.lead_id = l.id and o.kind = ''pos_'' || t.outcome)'),
      -- welcome é o ÚNICO que não olha o gate mestre do lead. Mantido assim de propósito (decisão
      -- do dono): passar a olhar cortaria boas-vindas de 9.743 leads de uma vez.
      ('fn_followup_candidates_welcome',
       'and coalesce(l.is_not_lead, false) = false',
       'and not exists (select 1 from lead_followup_optout o where o.lead_id = l.id and o.kind = ''welcome'')'),
      -- gatilho de encerramento: plpgsql, então a cláusula é um IF
      ('fn_ticket_finish_message',
       'if not v_fu_enabled then return NEW; end if;',
       'if exists (select 1 from lead_followup_optout o where o.lead_id = NEW.lead_id and o.kind = ''finish_'' || v_event) then return NEW; end if;'),
      -- o ramo finish_* do preview conta tickets por conta própria (não passa pelos geradores):
      -- sem isto a tela mostraria no histórico gente que já não recebe mais.
      ('preview_followup_activation',
       'and coalesce(l.followup_enabled, true) = true',
       'and not exists (select 1 from lead_followup_optout o where o.lead_id = l.id and o.kind = p_kind)')
    ) AS s(fn, ancora, clausula)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = r.fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'opt-out: função %.% não encontrada', 'public', r.fn;
    END IF;

    -- Idempotente: se já tem a cláusula, não injeta de novo.
    IF position('lead_followup_optout' in v_def) > 0 THEN
      CONTINUE;
    END IF;

    IF position(r.ancora in v_def) = 0 THEN
      RAISE EXCEPTION 'opt-out: âncora não encontrada em % (esperado: %)', r.fn, r.ancora;
    END IF;

    v_new := replace(v_def, r.ancora, r.ancora || E'\n    ' || r.clausula);
    EXECUTE v_new;
  END LOOP;
END $$;

-- Trava de conferência: os 7 pontos têm de estar cobertos ao fim desta migração.
DO $$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_faltando
    FROM (VALUES
      ('fn_followup_candidates_reengagement'), ('fn_followup_candidates_confirmation'),
      ('fn_followup_candidates_appt_reminder'), ('fn_followup_candidates_pos'),
      ('fn_followup_candidates_welcome'), ('fn_ticket_finish_message'),
      ('preview_followup_activation')) AS s(f)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = s.f
        AND p.prosrc LIKE '%lead_followup_optout%');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'opt-out: motores sem a checagem: %', v_faltando;
  END IF;
END $$;
