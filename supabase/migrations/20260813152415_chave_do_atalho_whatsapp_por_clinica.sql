-- Chave por clínica para o atalho "Abrir no WhatsApp" que fica no topo de toda conversa.
--
-- OPT-OUT (`is not false`), e isso é decisão, não descuido: o atalho subiu LIGADO para todos os
-- tenants em 13/08/2026. Nascer opt-in apagaria o botão de todo mundo de uma vez e sem erro
-- nenhum, que é exatamente o modo de falha do CLAUDE.md §0.3.
--
-- Coluna própria em vez de mais uma chave em `clinics.features`: `features` é o plano vendido
-- (quem edita é Super Admin / OrgAdmin), e isto aqui é preferência de tela que o PRÓPRIO cliente
-- mexe, em Configurações › Integrações › WhatsApp. Mesmo padrão de `quote_use_products` e
-- `quote_use_protocols`.
alter table public.clinics
  add column if not exists wa_shortcut_enabled boolean not null default true;

comment on column public.clinics.wa_shortcut_enabled is
  'Mostra o atalho "Abrir no WhatsApp" (link wa.me) no topo das conversas. Opt-out: só some com false explícito. Editado pelo cliente em Configurações › Integrações › WhatsApp.';
