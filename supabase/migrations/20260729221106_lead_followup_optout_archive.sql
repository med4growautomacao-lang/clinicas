-- Arquivo das exclusões de follow-up. Aplicada via MCP em 29/07/2026 (version 20260729221106);
-- este arquivo repõe a história no repo. Nome = versão real, então em produção é ignorada.
--
-- POR QUÊ: religar o follow-up apagava a linha e com ela QUEM excluiu, QUANDO e POR QUÊ — justamente
-- o registro que motivou criar a tabela (a coluna booleana antiga não guardava motivo, e é por isso
-- que não foi possível migrar os 9.743 leads já desligados). Segue o padrão da casa
-- (system_errors -> system_errors_archive): sai da tabela ativa, não se perde.
CREATE TABLE IF NOT EXISTS public.lead_followup_optout_archive (
  id           bigserial PRIMARY KEY,
  clinic_id    uuid NOT NULL,
  lead_id      uuid NOT NULL,
  kind         text NOT NULL,
  created_at   timestamptz NOT NULL,
  created_by   uuid,
  reason       text,
  removed_at   timestamptz NOT NULL DEFAULT now(),
  removed_by   uuid
);
CREATE INDEX IF NOT EXISTS idx_lfo_arch_lead   ON public.lead_followup_optout_archive(lead_id, kind);
CREATE INDEX IF NOT EXISTS idx_lfo_arch_clinic ON public.lead_followup_optout_archive(clinic_id);

ALTER TABLE public.lead_followup_optout_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lfo_archive_select ON public.lead_followup_optout_archive;
CREATE POLICY lfo_archive_select ON public.lead_followup_optout_archive
  FOR SELECT USING (
    clinic_id IN (SELECT public.my_clinic_ids()) OR (SELECT public.is_super_admin())
  );

-- ACL default de tabela fechada na mão (já vazou CRUD p/ anon neste projeto uma vez).
REVOKE ALL ON TABLE public.lead_followup_optout_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.lead_followup_optout_archive TO authenticated;
GRANT ALL    ON TABLE public.lead_followup_optout_archive TO service_role;
REVOKE ALL ON SEQUENCE public.lead_followup_optout_archive_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.lead_followup_optout_archive_id_seq TO service_role;

-- Arquiva em QUALQUER delete (RPC, mão, cascade de lead/clínica): a trilha não depende de o
-- chamador lembrar de arquivar.
CREATE OR REPLACE FUNCTION public.fn_archive_lead_followup_optout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO lead_followup_optout_archive
    (clinic_id, lead_id, kind, created_at, created_by, reason, removed_at, removed_by)
  VALUES (OLD.clinic_id, OLD.lead_id, OLD.kind, OLD.created_at, OLD.created_by, OLD.reason,
          now(), auth.uid());
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Arquivar NUNCA pode impedir o religar (senão o contato fica preso sem receber).
  PERFORM log_system_error('followup-optout', 'archive_failed',
    'Falha ao arquivar exclusão de follow-up (o religar seguiu em frente)', 'warn',
    OLD.clinic_id, jsonb_build_object('lead_id', OLD.lead_id, 'kind', OLD.kind, 'detail', sqlerrm), false);
  RETURN OLD;
END; $function$;

DROP TRIGGER IF EXISTS trg_archive_lead_followup_optout ON public.lead_followup_optout;
CREATE TRIGGER trg_archive_lead_followup_optout
BEFORE DELETE ON public.lead_followup_optout
FOR EACH ROW EXECUTE FUNCTION public.fn_archive_lead_followup_optout();
