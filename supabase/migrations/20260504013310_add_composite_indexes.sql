-- 20260504013310_add_composite_indexes
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- leads: query principal paginada (clinic_id + ordenação)
CREATE INDEX IF NOT EXISTS idx_leads_clinic_activity
  ON leads (clinic_id, last_activity_at DESC NULLS LAST, updated_at DESC NULLS LAST);

-- leads: busca por converted_patient_id (usado em onAppointmentRealizado)
CREATE INDEX IF NOT EXISTS idx_leads_converted_patient
  ON leads (converted_patient_id)
  WHERE converted_patient_id IS NOT NULL;

-- appointments: query com janela de datas (clinic_id + date)
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date
  ON appointments (clinic_id, date DESC);

-- appointments: filtro por status
CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON appointments (clinic_id, status);

-- chat_messages: busca de thread por lead ordenada por data
CREATE INDEX IF NOT EXISTS idx_chat_messages_lead_date
  ON chat_messages (lead_id, created_at ASC);

-- chat_messages: busca por telefone
CREATE INDEX IF NOT EXISTS idx_chat_messages_phone
  ON chat_messages (clinic_id, phone);

-- financial_transactions: dashboard stats (clinic + tipo + status + data)
CREATE INDEX IF NOT EXISTS idx_financial_clinic_type_status
  ON financial_transactions (clinic_id, type, status, date DESC);

-- conversions: ordenação por data de conversão
CREATE INDEX IF NOT EXISTS idx_conversions_clinic_date
  ON conversions (clinic_id, converted_at DESC);

-- patients: ordenação por nome
CREATE INDEX IF NOT EXISTS idx_patients_clinic_name
  ON patients (clinic_id, name);
