-- Etapa de conversao configuravel por clinica para a tela de Marketing.
--
-- Antes: "conversao" era hardcoded (criada ao mover para slug 'ganho' e tambem
-- 'orcamento'). Agora cada clinica escolhe QUAL etapa do funil marca a conversao.
-- Padrao: a etapa com slug 'ganho' (presente em todas as clinicas).
--
-- O card "Conversoes" do Marketing passa a contar leads que ENTRARAM nesta etapa
-- no periodo (por lead_stage_history.changed_at, modelo por evento, igual ao
-- modulo Comercial). O FUNIL continua coorte (por leads.created_at) e NAO muda.

ALTER TABLE public.funnel_stages
  ADD COLUMN IF NOT EXISTS is_conversion boolean NOT NULL DEFAULT false;

-- Backfill: marca a etapa 'ganho' de cada clinica como conversao (uma por clinica).
UPDATE public.funnel_stages s
   SET is_conversion = true
 WHERE s.slug = 'ganho'
   AND NOT EXISTS (
     SELECT 1 FROM public.funnel_stages s2
      WHERE s2.clinic_id = s.clinic_id AND s2.is_conversion
   );

-- No maximo uma etapa de conversao por clinica.
CREATE UNIQUE INDEX IF NOT EXISTS funnel_stages_one_conversion_per_clinic
  ON public.funnel_stages (clinic_id) WHERE is_conversion;
