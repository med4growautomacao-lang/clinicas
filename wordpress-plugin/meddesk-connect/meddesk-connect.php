<?php
/**
 * Plugin Name:       MedDesk Connect
 * Plugin URI:        https://meddesk.com.br/
 * Description:       Connects the site to the MedDesk/WakeDesk platform for lead attribution: loads the tracking script (source and UTM) once the account identifier is set.
 * Version:           1.0.0
 * Requires at least: 5.5
 * Requires PHP:      7.2
 * Author:            MED4GROW
 * Author URI:        https://med4growautomacao.com.br/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       meddesk-connect
 *
 * The plugin does ONE thing: it enqueues, on every front-end page, the tracking script of the
 * MedDesk/WakeDesk platform — and only when the account identifier (a UUID) is set. Without the
 * identifier it loads nothing. The identifier is writable through the REST API (/wp/v2/settings),
 * which lets the platform configure it remotely with the site administrator's permission. The
 * plugin runs no user-provided code and has no settings screen of its own.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'MEDDESK_CONNECT_VERSION' ) ) {
	define( 'MEDDESK_CONNECT_VERSION', '1.0.0' );
}
if ( ! defined( 'MEDDESK_CONNECT_OPTION' ) ) {
	define( 'MEDDESK_CONNECT_OPTION', 'meddesk_clinic_id' );
}
if ( ! defined( 'MEDDESK_CONNECT_HANDLE' ) ) {
	define( 'MEDDESK_CONNECT_HANDLE', 'meddesk-connect' );
}
if ( ! defined( 'MEDDESK_CONNECT_SCRIPT_BASE' ) ) {
	// Fixed address of the platform script. Can be overridden with the filter below.
	define( 'MEDDESK_CONNECT_SCRIPT_BASE', 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/site-script' );
}

/**
 * Registers the identifier option, exposed to the REST API for remote configuration.
 * Must run on both admin_init and rest_api_init (admin_init alone does not expose it in
 * /wp/v2/settings).
 */
function meddesk_connect_register_setting() {
	register_setting(
		'meddesk_connect',
		MEDDESK_CONNECT_OPTION,
		array(
			'type'              => 'string',
			'description'       => 'Account identifier on the MedDesk/WakeDesk platform.',
			'sanitize_callback' => 'meddesk_connect_sanitize_id',
			'show_in_rest'      => true,
			'default'           => '',
		)
	);
}
add_action( 'admin_init', 'meddesk_connect_register_setting' );
add_action( 'rest_api_init', 'meddesk_connect_register_setting' );

/**
 * Accepts only a UUID (the account identifier). Any other value is discarded — so there is no
 * injection surface: the script URL is built by the plugin from this UUID.
 *
 * @param mixed $value Received value.
 * @return string Lowercased UUID, or empty string if invalid.
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
 * Enqueues the tracking script on every front-end page, only when the identifier is set.
 * The plugin version is used as the script version so a plugin update busts the browser cache.
 */
function meddesk_connect_enqueue_script() {
	$id = get_option( MEDDESK_CONNECT_OPTION, '' );
	if ( ! is_string( $id ) || '' === $id ) {
		return;
	}
	$base = apply_filters( 'meddesk_connect_script_base', MEDDESK_CONNECT_SCRIPT_BASE );
	$src  = add_query_arg( 'c', rawurlencode( $id ), $base );
	wp_enqueue_script( MEDDESK_CONNECT_HANDLE, $src, array(), MEDDESK_CONNECT_VERSION, false );
}
add_action( 'wp_enqueue_scripts', 'meddesk_connect_enqueue_script' );

/**
 * Adds the defer attribute to our script tag, keeping compatibility with WordPress versions
 * older than the enqueue "strategy" argument (6.3+).
 *
 * @param string $tag    The full script tag.
 * @param string $handle The script handle.
 * @return string
 */
function meddesk_connect_defer_tag( $tag, $handle ) {
	if ( MEDDESK_CONNECT_HANDLE === $handle && false === strpos( $tag, ' defer' ) ) {
		$tag = str_replace( ' src=', ' defer src=', $tag );
	}
	return $tag;
}
add_filter( 'script_loader_tag', 'meddesk_connect_defer_tag', 10, 2 );
