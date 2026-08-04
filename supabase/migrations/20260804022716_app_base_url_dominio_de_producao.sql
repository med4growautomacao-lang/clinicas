-- Dominio publico do app, informado pelo dono em 03/08/2026. Sem ele o aviso de
-- WhatsApp desconectado sai sem o link de reconexao.
--
-- Ate agora esse dominio nao existia em lugar nenhum que o backend alcancasse: a
-- tela monta o link com window.location.origin (o endereco do navegador), o
-- config.toml nao tem site_url e o site_url do Auth do Supabase esta em
-- http://localhost:3000. Procurado tambem nas mensagens ja enviadas e no
-- system_settings: nao havia.
--
-- ⚠️ UPDATE GUARDADO, de proposito: so preenche se estiver VAZIO. `system_settings`
-- e editavel pelo Super Admin, entao um update cru aqui reverteria, num replay, a
-- troca de dominio feita pela tela.
--
-- Conferido: a montagem `<app_base_url>/connect?token=<connect_token>` reproduz byte
-- a byte o link que o dono copiou da tela de Integracoes (clinica MedDesk
-- Demonstrativa). Das 28 clinicas ativas com WhatsApp, todas as 28 tem
-- connect_token, entao quem tiver grupo cadastrado recebe o aviso COM link.
update system_settings
   set value = 'https://app.med4growautomacao.com.br', updated_at = now()
 where id = 'app_base_url'
   and coalesce(btrim(value), '') = '';
