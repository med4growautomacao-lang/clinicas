<?php
/**
 * Plugin Name:       MedDesk Connect
 * Plugin URI:        https://meddesk.com.br/
 * Description:       Conecta o site à plataforma MedDesk/WakeDesk para atribuição de leads: instala o script de rastreamento (origem e UTM) quando o identificador da sua conta é informado.
 * Version:           1.0.0
 * Requires at least: 5.5
 * Requires PHP:      7.2
 * Author:            MED4GROW
 * Author URI:        https://meddesk.com.br/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       meddesk-connect
 *
 * O plugin faz UMA coisa: imprime, no <head> de todas as páginas, a tag do script de
 * rastreamento da plataforma — e só quando o identificador da conta (um UUID) está definido.
 * Sem identificador, não imprime nada. O identificador é gravável pela REST API
 * (/wp/v2/settings), o que permite à plataforma configurar remotamente com a permissão do
 * administrador do site. Não executa código do usuário e não tem tela própria.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'MEDDESK_CONNECT_OPTION' ) ) {
	define( 'MEDDESK_CONNECT_OPTION', 'meddesk_clinic_id' );
}
if ( ! defined( 'MEDDESK_CONNECT_SCRIPT_BASE' ) ) {
	// Endereço fixo do script da plataforma. Pode ser sobrescrito pelo filtro abaixo.
	define( 'MEDDESK_CONNECT_SCRIPT_BASE', 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/site-script' );
}

/**
 * Registra a opção do identificador, exposta na REST API para configuração remota.
 * Precisa rodar em admin_init E em rest_api_init (só admin_init não expõe no /wp/v2/settings).
 */
function meddesk_connect_register_setting() {
	register_setting(
		'meddesk_connect',
		MEDDESK_CONNECT_OPTION,
		array(
			'type'              => 'string',
			'description'       => 'Identificador da conta na plataforma MedDesk/WakeDesk.',
			'sanitize_callback' => 'meddesk_connect_sanitize_id',
			'show_in_rest'      => true,
			'default'           => '',
		)
	);
}
add_action( 'admin_init', 'meddesk_connect_register_setting' );
add_action( 'rest_api_init', 'meddesk_connect_register_setting' );

/**
 * Só aceita um UUID (o identificador da conta). Qualquer outro valor é descartado — assim não há
 * superfície de injeção: a URL do script é montada pelo plugin a partir deste UUID.
 *
 * @param mixed $value Valor recebido.
 * @return string UUID em minúsculas, ou string vazia se inválido.
 */
function meddesk_connect_sanitize_id( $value ) {
	$value = is_string( $value ) ? trim( $value ) : '';
	if ( '' === $value ) {
		return '';
	}
	if ( preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value ) ) {
		return strtolower( $value );
	}
	return '';
}

/**
 * Imprime a tag do script no <head>, em todas as páginas, apenas quando o identificador existe.
 */
function meddesk_connect_print_script() {
	$id = get_option( MEDDESK_CONNECT_OPTION, '' );
	if ( ! is_string( $id ) || '' === $id ) {
		return;
	}
	$base = apply_filters( 'meddesk_connect_script_base', MEDDESK_CONNECT_SCRIPT_BASE );
	$src  = add_query_arg( 'c', rawurlencode( $id ), $base );
	echo '<script src="' . esc_url( $src ) . '" defer></script>' . "\n";
}
add_action( 'wp_head', 'meddesk_connect_print_script' );
