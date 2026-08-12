-- 20260720064012_fix_handle_new_clinic_api_id_null
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- BUG: handle_new_clinic() insere whatsapp_instances.api_id = '' (string vazia).
-- O índice único ux_whatsapp_instances_api_id (WHERE api_id IS NOT NULL) trata '' como
-- valor real e único → a 2ª clínica criada colide (já havia 1 linha com ''). O sentinela
-- de "não conectado" é NULL (excluído do índice; 2 linhas já são NULL). Correção: usar NULL.
CREATE OR REPLACE FUNCTION public.handle_new_clinic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    INSERT INTO public.ai_config (clinic_id)
    VALUES (NEW.id) ON CONFLICT (clinic_id) DO NOTHING;

    INSERT INTO public.whatsapp_instances (clinic_id, api_token, api_id)
    VALUES (NEW.id, NULL, NULL) ON CONFLICT (clinic_id) DO NOTHING;

    INSERT INTO public.funnel_stages (clinic_id, name, slug, position, color, is_system) VALUES
      (NEW.id, 'Sincronização',        'sincronizacao',   0, '#8b5cf6',       true),
      (NEW.id, 'Contato via Forms',    'forms',           1, 'bg-blue-500',   true),
      (NEW.id, 'Contato via WhatsApp', 'whatsapp',        2, 'bg-emerald-500',true),
      (NEW.id, 'Qualificado',          null,              3, 'bg-teal-500',   false),
      (NEW.id, 'Orçamento Enviado',    null,              4, 'bg-purple-500', false),
      (NEW.id, 'Agendado',             null,              5, 'bg-amber-500',  false),
      (NEW.id, 'Compareceu',           'compareceu',      6, 'bg-indigo-500', false),
      (NEW.id, 'Ganho',                'ganho',           7, 'bg-green-600',  true),
      (NEW.id, 'Faltou/Cancelou',      'faltou_cancelou', 8, 'bg-orange-500', false),
      (NEW.id, 'Perdido',              'perdido',         9, 'bg-red-600',    true)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$function$;
