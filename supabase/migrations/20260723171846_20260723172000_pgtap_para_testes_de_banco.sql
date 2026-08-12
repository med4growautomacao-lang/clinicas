-- 20260723171846_20260723172000_pgtap_para_testes_de_banco
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- pgTAP: testes de banco de verdade. Entra agora porque o Emissor (outbox de saida) tem
-- invariantes que NAO podem ser verificadas por leitura de codigo: nao duplicar envio, preservar
-- a ordem das bolhas por conversa, e (no sandbox) nunca vazar para a uazapi. Sem teste, cada uma
-- dessas so seria descoberta em producao, com paciente real do outro lado.
--
-- Instalado no schema `extensions` (convencao do Supabase): nao polui o `public` nem aparece no
-- PostgREST. Nao altera nenhum objeto existente; e puramente aditivo.
create extension if not exists pgtap with schema extensions;
