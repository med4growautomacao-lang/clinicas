-- Cifra a Application Password do WordPress em repouso. Era texto puro (dívida apontada em
-- [[wordpress-integrator-feature]]): credencial de admin do site do cliente, raio de explosão = a
-- frota. Chave simétrica no Vault (mesmo padrão de Google/Meta), cripto via pgcrypto.

-- 1) Chave no Vault (cria só se não existir). 32 bytes aleatórios em hex.
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'WORDPRESS_ENC_KEY';
  if v_id is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'WORDPRESS_ENC_KEY',
      'Chave simétrica para cifrar wordpress_app_password (integrador WordPress)'
    );
  end if;
end $$;

-- 2) Coluna cifrada.
alter table public.clinic_external_integrations
  add column if not exists wordpress_app_password_enc bytea;

-- 3) Helper interno: a chave do Vault. Nunca exposto ao front.
create or replace function public._wp_enc_key()
returns text language sql stable security definer set search_path to 'public'
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'WORDPRESS_ENC_KEY' limit 1 $$;
revoke all on function public._wp_enc_key() from public, anon, authenticated;

-- 4) Backfill: cifra o que já existe em texto puro e apaga o texto puro.
update public.clinic_external_integrations
   set wordpress_app_password_enc = extensions.pgp_sym_encrypt(wordpress_app_password, public._wp_enc_key())
 where wordpress_app_password is not null and btrim(wordpress_app_password) <> ''
   and wordpress_app_password_enc is null;
update public.clinic_external_integrations
   set wordpress_app_password = null
 where wordpress_app_password is not null;

-- 5) Escrita pelo front (cifra). Semântica parcial do password: NULL = mantém, '' = limpa, valor = grava.
--    url/username não são segredo, gravados como vieram. Nunca reconstrói a linha inteira.
--    Authz espelha a policy cei_update (membro da clínica, admin da clínica, ou super).
create or replace function public.set_wordpress_integration(
  p_clinic_id uuid, p_url text, p_username text, p_app_password text
) returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_pass text := nullif(btrim(coalesce(p_app_password, '')), '');
begin
  if not (public.is_super_admin() or public.is_clinic_admin(p_clinic_id) or p_clinic_id in (select public.my_clinic_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.clinic_external_integrations (clinic_id) values (p_clinic_id)
  on conflict (clinic_id) do nothing;

  update public.clinic_external_integrations
     set wordpress_url = nullif(btrim(coalesce(p_url, '')), ''),
         wordpress_username = nullif(btrim(coalesce(p_username, '')), ''),
         wordpress_app_password = null,  -- nunca mais texto puro
         wordpress_app_password_enc = case
           when p_app_password is null then wordpress_app_password_enc                       -- mantém
           when v_pass is null then null                                                     -- limpa (mandou vazio)
           else extensions.pgp_sym_encrypt(v_pass, public._wp_enc_key())                     -- grava cifrado
         end,
         updated_at = now()
   where clinic_id = p_clinic_id;
end $$;
revoke all on function public.set_wordpress_integration(uuid, text, text, text) from public, anon;
grant execute on function public.set_wordpress_integration(uuid, text, text, text) to authenticated;

-- 6) Leitura pelo backend (decifra). SÓ service_role — a edge integradora chama com service key.
create or replace function public.get_wordpress_credentials(p_clinic_id uuid)
returns table(wordpress_url text, wordpress_username text, app_password text)
language sql stable security definer set search_path to 'public'
as $$
  select cei.wordpress_url, cei.wordpress_username,
         case when cei.wordpress_app_password_enc is not null
              then extensions.pgp_sym_decrypt(cei.wordpress_app_password_enc, public._wp_enc_key())
              else null end
  from public.clinic_external_integrations cei
  where cei.clinic_id = p_clinic_id
$$;
revoke all on function public.get_wordpress_credentials(uuid) from public, anon, authenticated;
grant execute on function public.get_wordpress_credentials(uuid) to service_role;
