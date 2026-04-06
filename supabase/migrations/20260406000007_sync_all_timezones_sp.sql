-- Migration to align related tables' timestamps to São Paulo time (UTC-3)
-- This ensures consistency with the 'leads' table change.

-- 1. lead_stage_history
ALTER TABLE public.lead_stage_history 
  ALTER COLUMN changed_at TYPE TIMESTAMP WITHOUT TIME ZONE USING changed_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN changed_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 2. automation_logs
ALTER TABLE public.automation_logs 
  ALTER COLUMN triggered_at TYPE TIMESTAMP WITHOUT TIME ZONE USING triggered_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN triggered_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 3. chat_messages
ALTER TABLE public.chat_messages 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 4. appointments
ALTER TABLE public.appointments 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
  ALTER COLUMN reminder_sent_at TYPE TIMESTAMP WITHOUT TIME ZONE USING reminder_sent_at AT TIME ZONE 'America/Sao_Paulo';

-- 5. marketing_data
ALTER TABLE public.marketing_data 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 6. patients
ALTER TABLE public.patients 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 7. clinics
ALTER TABLE public.clinics 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 8. users
ALTER TABLE public.users 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 9. doctors
ALTER TABLE public.doctors 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 10. medical_records
ALTER TABLE public.medical_records 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 11. financial_transactions
ALTER TABLE public.financial_transactions 
  ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE USING created_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- 12. ai_config
ALTER TABLE public.ai_config 
  ALTER COLUMN updated_at TYPE TIMESTAMP WITHOUT TIME ZONE USING updated_at AT TIME ZONE 'America/Sao_Paulo',
  ALTER COLUMN updated_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');
