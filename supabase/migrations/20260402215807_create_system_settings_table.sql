-- 20260402215807_create_system_settings_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE IF NOT EXISTS public.system_settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
CREATE POLICY "System settings are viewable by everyone" ON public.system_settings
  FOR SELECT USING (true);

-- Allow write access only to super-admins
CREATE POLICY "System settings can be updated by authenticated users" ON public.system_settings
  FOR UPDATE USING (auth.role() = 'authenticated');
  
CREATE POLICY "System settings can be inserted by authenticated users" ON public.system_settings
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Insert initial default templates
INSERT INTO public.system_settings (id, value, description) VALUES
('webhook_lead_catch_url', 'https://n8n.webhook.com/webhook/lead-catch/{{CLINIC_ID}}', 'URL do Webhook para recebimento de leads (Substitua a variável pela identificação da clínica)'),
('whatsapp_button_template', 'https://api.whatsapp.com/send?phone=SEUNUMERO&text=Olá! Vim pelo site. [ID:{{CLINIC_ID}}]', 'Template do Link de WhatsApp para o site onde o ID do tenant é anexado'),
('google_ads_script_template', '<script>
  (function(){
    const urlParams = new URLSearchParams(window.location.search);
    const utms = {
      g_campaign: urlParams.get(''utm_campaign'') || '''',
      g_term: urlParams.get(''utm_term'') || '''',
      g_source: urlParams.get(''utm_source'') || '''',
      g_clid: urlParams.get(''gclid'') || ''''
    };
    const rastId = ''rast_'' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(''clinicas_rast_id'', rastId);
    localStorage.setItem(''clinicas_google_utms'', JSON.stringify(utms));
    window.clinicasRastId = rastId;
  })();
</script>', 'Script Padrão para Inserção em Landing Pages e Captação UTM Google')
ON CONFLICT (id) DO NOTHING;
