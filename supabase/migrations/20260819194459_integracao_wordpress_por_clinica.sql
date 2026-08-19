-- Integração WordPress por clínica (aba Integração Externa): guarda o endereço do site,
-- o usuário e a Application Password do WordPress (senha de aplicativo nativa, WP 5.6+),
-- para instalar o script de rastreamento e automações futuras via REST API do site.
-- Mora aqui (e não em system_settings/Vault global) porque é credencial POR CLÍNICA,
-- mesma classe de segredo dos vizinhos capture_token/crm_token: a RLS da tabela já
-- restringe à equipe da própria clínica.
alter table public.clinic_external_integrations
  add column if not exists wordpress_url text,
  add column if not exists wordpress_username text,
  add column if not exists wordpress_app_password text;

comment on column public.clinic_external_integrations.wordpress_app_password is
  'Application Password do WordPress (Usuários > Perfil > Senhas de aplicativo). Revogável pelo cliente a qualquer momento.';
