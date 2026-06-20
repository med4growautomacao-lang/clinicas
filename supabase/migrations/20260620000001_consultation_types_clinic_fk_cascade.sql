-- Fix: excluir uma clínica falhava com
--   'update or delete on table "clinics" violates foreign key constraint
--    "consultation_types_clinic_id_fkey" on table "consultation_types"'
--
-- Todas as FKs que referenciam clinics estão como ON DELETE CASCADE, exceto
-- consultation_types_clinic_id_fkey, que estava como NO ACTION. A função
-- delete_clinic_cascade() apenas remove os usuarios e da DELETE FROM clinics,
-- confiando no CASCADE das tabelas filhas -- por isso quebrava so nesta.
--
-- appointments.consultation_type_id -> consultation_types e ON DELETE SET NULL,
-- e os appointments da propria clinica ja sao removidos em cascata, entao
-- cascatear consultation_types e seguro e consistente com as demais filhas.

ALTER TABLE public.consultation_types
  DROP CONSTRAINT consultation_types_clinic_id_fkey;

ALTER TABLE public.consultation_types
  ADD CONSTRAINT consultation_types_clinic_id_fkey
  FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
