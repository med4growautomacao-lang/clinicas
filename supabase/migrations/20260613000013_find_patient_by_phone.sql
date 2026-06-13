-- Lookup de paciente por telefone NORMALIZADO (para a edge ai-scheduler).
-- get_patient_appointments/get_patient_history buscavam por igualdade exata; o n8n manda
-- o telefone da sessao com 9o digito e o paciente esta canonico -> "nao encontrado".
-- Critico para as novas tools de reagendar/cancelar (que dependem do appointment_id
-- vindo de CONSULTAR_AGENDAMENTOS). Retorna tambem o canonical_phone para a edge usar
-- nas demais buscas (leads etc.).
CREATE OR REPLACE FUNCTION public.find_patient_by_phone(p_clinic_id uuid, p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'canonical_phone', normalize_br_phone(p_phone),
    'patient', (SELECT to_jsonb(x) FROM (
        SELECT id, name, cpf, created_at FROM patients
        WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = normalize_br_phone(p_phone)
        LIMIT 1) x)
  );
$$;
