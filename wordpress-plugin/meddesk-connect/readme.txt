=== MedDesk Connect ===
Contributors: med4grow
Tags: analytics, lead tracking, utm, attribution, marketing
Requires at least: 5.5
Tested up to: 7.1
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Conecta seu site à plataforma MedDesk/WakeDesk para atribuição de leads, instalando o script de rastreamento de origem e UTM.

== Description ==

MedDesk Connect instala, de forma leve, o script de rastreamento da plataforma MedDesk/WakeDesk no seu site, para atribuir corretamente a origem dos seus contatos (campanha, UTM) quando um visitante interage com seus botões e formulários.

O script só é inserido quando o identificador da sua conta está configurado. Sem esse identificador, o plugin não faz absolutamente nada. O plugin não tem tela de configuração própria: normalmente a sua agência informa o identificador de forma remota, com a sua autorização.

= Serviço externo =

Ao ser configurado, este plugin carrega um script a partir da infraestrutura da MED4GROW, hospedada no endpoint `https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/site-script`. Esse script registra a página de origem e os parâmetros de campanha (UTM e cliques de anúncio) do visitante que interage com seus botões e formulários, e os associa ao seu atendimento na plataforma MedDesk/WakeDesk.

* Site do serviço: https://meddesk.com.br
* Host do script carregado: https://yzpclhuifquhfqpiwysh.supabase.co
* Política de privacidade: https://med4growautomacao.com.br/meddeskconnect/privacidade
* Termos de uso: https://med4growautomacao.com.br/meddeskconnect/termo

O uso do serviço está sujeito a essa política de privacidade e a esses termos.

== Installation ==

1. Instale e ative o plugin MedDesk Connect.
2. Informe o identificador da sua conta (fornecido pela plataforma). Em geral, sua agência faz isso remotamente, com a sua autorização.

Depois de configurado, o script de rastreamento passa a ser carregado em todas as páginas do site.

== Frequently Asked Questions ==

= O plugin coleta dados dos meus visitantes? =

O plugin, por si só, não coleta nada. Quando configurado, ele carrega um script que registra a origem (UTM/campanha) de quem interage com seus botões e formulários, para atribuição de leads. Nada é carregado enquanto o identificador não estiver configurado.

= Preciso configurar algo manualmente? =

Normalmente não. A plataforma configura o identificador remotamente, com a sua autorização (senha de aplicativo). Você também pode informá-lo manualmente, se preferir.

= Como removo o rastreamento? =

Basta desativar o plugin, ou limpar o identificador da conta.

== Changelog ==

= 1.0.0 =
* Versão inicial: imprime o script de rastreamento no cabeçalho do site quando o identificador da conta está configurado.
