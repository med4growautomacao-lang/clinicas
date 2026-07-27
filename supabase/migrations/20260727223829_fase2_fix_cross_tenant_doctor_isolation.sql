-- FASE 2: fecha o vazamento cross-tenant de LEITURA em appointments e medical_records.
--
-- As policies *_doctor_isolation (PERMISSIVE, FOR SELECT) tinham um braço
--   EXISTS (SELECT 1 FROM clinic_users WHERE id = auth.uid() AND role IN ('gestor','medico_gestor','secretaria'))
-- que NÃO correlaciona clinic_users.clinic_id com a linha, então qualquer staff de qualquer
-- clínica ativa lia 100% das consultas/prontuários de TODAS as clínicas ativas (medido: um staff
-- de clínica com 0 consultas via 234, todas alheias).
--
-- Por que DROP e não reescrever: sendo PERMISSIVE, removê-las só REDUZ acesso. O acesso legítimo
-- que elas concediam (staff/médico vendo a PRÓPRIA clínica) já é integralmente coberto por
-- appointments_all / medical_records_all (clinic_id IN clinic_users do usuário). E medicos_orfaos=0
-- (todo médico é clinic_user da própria clínica), então o braço do médico também é redundante.
-- Resultado: perde-se só o vazamento. Medido depois: staff 234->0, gestor 234->30 (só as próprias).
--
-- Isolamento "médico só vê os próprios" (intra-clínica) permanece decisão de produto em aberto:
-- appointments_all já dá a agenda inteira da clínica a qualquer membro; impor isolamento exigiria
-- policy RESTRICTIVE, fora do escopo deste fix de segurança.

drop policy appointments_doctor_isolation on public.appointments;
drop policy medical_records_doctor_isolation on public.medical_records;
