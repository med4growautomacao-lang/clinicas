-- Offline: default para physical_store (janela de 62 dias), nao system_generated (~7 dias).
-- Motivo: o caso de uso e backfill de vendas PASSADAS (dias/semanas atras); com system_generated
-- a Meta recusa o event_time antigo (subcode 2804003 "Registro de data e hora do evento").
-- Testado: com physical_store a Meta respondeu events_received:1 (venda de 17 dias atras aceita).
update public.system_settings
   set value = (coalesce(value::jsonb,'{}'::jsonb) || '{"offline_action_source":"physical_store"}'::jsonb)::text,
       updated_at = now()
 where id = 'meta_capi_config';
