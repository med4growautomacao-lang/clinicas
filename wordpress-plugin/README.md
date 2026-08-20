# Mini-plugin WordPress — MedDesk Connect

Fase 2 do [integrador WordPress](../supabase/functions/wordpress-integrator/index.ts). Cobre os sites que **não** têm Elementor Pro (Elementor Free, tema clássico, Gutenberg): imprime a tag do `site-script` no `wp_head` de todas as páginas.

## Por que existe

A tag `<script>` é removida pelo `kses` de quem não tem `unfiltered_html`, e o Elementor Free não tem Custom Code site-wide. Um plugin que imprime a tag **no próprio PHP** dribla as duas coisas: só um UUID (o `clinic_id`) viaja pela API, nunca a tag. E o `POST /wp/v2/plugins` do core **só instala plugin do diretório oficial por slug** (não aceita upload de zip) — por isso o plugin precisa estar publicado no wordpress.org.

## O que ele faz (e não faz)

- Registra a option `meddesk_clinic_id` com `show_in_rest`, gravável por `/wp/v2/settings` (a plataforma configura remota, com a senha de aplicativo do admin).
- Só aceita **UUID** na option (sanitize) — zero superfície de injeção.
- Imprime `<script src=".../site-script?c=<uuid>" defer>` no `wp_head` **só** quando a option está setada.
- **Não** executa código do usuário, **não** tem tela própria, **não** coleta nada sem o identificador.

## Amarração com a edge

A edge `wordpress-integrator` tem o caminho `plugin_proprio` **desligado** até o plugin ser publicado. Para ligar depois da aprovação:

1. Setar o secret da edge: `MEDDESK_WP_PLUGIN_SLUG=meddesk-connect`.
2. A edge passa a: `POST /wp/v2/plugins {slug:'meddesk-connect', status:'active'}` → `POST /wp/v2/settings {meddesk_clinic_id:<uuid>}` → validar no HTML.

⚠️ O arquivo principal **precisa** se chamar `meddesk-connect.php` (a edge reativa via `/wp/v2/plugins/meddesk-connect/meddesk-connect`). Não renomear sem ajustar a edge.

## Submissão ao diretório oficial (ação manual — precisa de humano)

Não dá para automatizar: exige conta wordpress.org com 2FA.

1. Zipar a pasta `meddesk-connect/` (só ela, com `meddesk-connect.php` + `readme.txt` na raiz do zip).
2. Antes de zipar, **preencher no `readme.txt`**: a URL real de **Política de privacidade** e **Termos** (exigência das guidelines 7 e 8 do diretório — plugin que carrega script externo precisa documentar o serviço e a privacidade). Sem isso, a revisão recusa.
3. Atualizar `Tested up to:` para a versão atual do WordPress no dia da submissão.
4. Enviar em https://wordpress.org/plugins/developers/add/ (conta com 2FA obrigatório).
5. Revisão inicial: ~1 a 2 semanas (uma vez só). O slug `meddesk-connect` é **permanente** e não muda depois.
6. Aprovado → publicar via SVN → setar `MEDDESK_WP_PLUGIN_SLUG` na edge.

## Manutenção

- Updates publicam direto via SVN, sem re-review (o time só intervém em denúncia).
- Manter `Tested up to` em dia a cada major do WordPress.
- Se o comportamento do `site-script` mudar, atualizar o readme (o serviço documentado precisa bater com o real, guideline 8).
