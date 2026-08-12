-- Qual das TRES camadas de token da Meta funcionou por ultimo nesta clinica:
--   'clinic'   -> clinics.meta_token          (o proprio cliente conectou)
--   'org'      -> organizations.meta_ad_token (a agencia dona da conta)
--   'platform' -> Vault META_CLOUD_TOKEN      (token da plataforma)
--
-- Regra do dono (23/07/2026): quando o token de uma camada da erro, TESTAR AS OUTRAS, e a que
-- funcionar passa a ser a PRINCIPAL nas buscas seguintes. Sem essa memoria, toda rodada gastaria
-- uma recusa na camada quebrada antes de chegar na boa, e a Central encheria de alarme por uma
-- falha que o fallback ja cobriu.
--
-- Contexto: em 21/07 o Tyago levou 370 recusas seguidas da Graph API porque a busca so conhecia
-- clinics.meta_token e nao tentava mais nada — sendo que a organizacao dele (Med4grow) TINHA um
-- token valido ao lado o tempo todo.
--
-- NULL = ainda nao se sabe (usa a ordem padrao cliente -> organizacao -> plataforma).

alter table public.clinics
  add column if not exists meta_token_source text;

comment on column public.clinics.meta_token_source is
  'Camada do token da Meta que funcionou por ultimo (clinic|org|platform). Preenchida sozinha pelo meta-forms-sync; NULL = usa a ordem padrao.';

alter table public.clinics
  drop constraint if exists clinics_meta_token_source_check;

alter table public.clinics
  add constraint clinics_meta_token_source_check
  check (meta_token_source is null or meta_token_source in ('clinic','org','platform'));
