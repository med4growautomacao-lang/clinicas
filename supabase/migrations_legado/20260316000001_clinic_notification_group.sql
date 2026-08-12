ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS notification_group_id text;

COMMENT ON COLUMN public.clinics.notification_group_id IS 'ID do grupo WhatsApp de notificações criado pelo Agente IA';
