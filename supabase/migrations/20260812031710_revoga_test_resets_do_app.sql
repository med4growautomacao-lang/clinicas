-- 20260812031710_revoga_test_resets_do_app
--
-- ⚠️ REVERTIDA 8 minutos depois pela 20260812032502_restaura_execute_test_resets.
-- O arquivo fica porque a migration FOI aplicada no banco, e migration é história, não estado.
-- Leia a de restauração antes de reaproveitar qualquer coisa daqui.
--
-- Intenção original: fechar as RPCs de reset de teste, que apagam histórico casando só por
-- telefone e tinham EXECUTE para qualquer usuário logado, sem guarda própria e sem auditoria.
--
-- Erro de análise: eu as classifiquei como ferramenta interna esquecida. São ferramenta do
-- CLIENTE, usada para testar a IA pelo próprio celular mais de uma vez.

revoke all on function public.test_reset_full(text) from public, anon, authenticated;
revoke all on function public.test_reset_for_rebook(text) from public, anon, authenticated;

comment on function public.test_reset_full(text) is
  'USO INTERNO. EXECUTE revogado do app em 12/08/2026: apagava prontuário/financeiro/conversa por telefone, sem auditoria e disponível a qualquer usuário logado. NÃO reconceder para authenticated.';

comment on function public.test_reset_for_rebook(text) is
  'USO INTERNO. EXECUTE revogado do app em 12/08/2026, mesmo motivo de test_reset_full. NÃO reconceder para authenticated.';
