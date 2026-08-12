-- 20260408151419_add_default_funnels_to_handle_new_clinic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.handle_new_clinic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Criar configuração de IA padrão
    INSERT INTO public.ai_config (clinic_id)
    VALUES (NEW.id)
    ON CONFLICT (clinic_id) DO NOTHING;

    -- Criar instância de WhatsApp padrão
    INSERT INTO public.whatsapp_instances (clinic_id, api_token, api_id)
    VALUES (NEW.id, '', '')
    ON CONFLICT (clinic_id) DO NOTHING;

    -- Criar funis de venda padrão
    INSERT INTO public.funnel_stages (clinic_id, name, position, color, is_system) VALUES
      (NEW.id, 'Sincronização',       0, '#8b5cf6',       true),
      (NEW.id, 'Contato via Forms',   1, 'bg-blue-500',   true),
      (NEW.id, 'Contato via WhatsApp',2, 'bg-emerald-500',true),
      (NEW.id, 'Qualificado',         3, 'bg-teal-500',   true),
      (NEW.id, 'Orçamento Enviado',   4, 'bg-purple-500', true),
      (NEW.id, 'Agendado',            5, 'bg-amber-500',  true),
      (NEW.id, 'Conversão',           6, 'bg-rose-500',   true),
      (NEW.id, 'Paciente',            7, 'bg-teal-500',   true),
      (NEW.id, 'Atendimento Humano',  8, 'bg-teal-500',   true),
      (NEW.id, 'Perdido',             9, 'bg-slate-500',  true)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$function$;
