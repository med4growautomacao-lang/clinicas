=== MedDesk Connect ===
Contributors: med4grow
Tags: analytics, lead tracking, utm, attribution, marketing
Requires at least: 5.5
Tested up to: 7.1
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects your site to the MedDesk/WakeDesk platform for lead attribution by loading its source and UTM tracking script.

== Description ==

MedDesk Connect adds a lightweight tracking script from the MedDesk/WakeDesk platform to your site, so the origin of your contacts (campaign, UTM) is attributed correctly when a visitor interacts with your buttons and forms.

The script is only added once your account identifier is configured. Without that identifier, the plugin does nothing at all. The plugin has no settings screen of its own: usually your agency sets the identifier remotely, with your authorization.

= External service =

Once configured, this plugin loads a script from MED4GROW infrastructure, hosted at the endpoint `https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/site-script`. That script records the source page and the campaign parameters (UTM and ad clicks) of visitors who interact with your buttons and forms, and associates them with your service on the MedDesk/WakeDesk platform.

* Service website: https://meddesk.com.br
* Host of the loaded script: https://yzpclhuifquhfqpiwysh.supabase.co
* Privacy policy: https://app.med4growautomacao.com.br/meddeskconnect/privacidade
* Terms of use: https://app.med4growautomacao.com.br/meddeskconnect/termo

Use of the service is subject to that privacy policy and those terms.

== Installation ==

1. Install and activate the MedDesk Connect plugin.
2. Set your account identifier (provided by the platform). In most cases your agency does this remotely, with your authorization.

Once configured, the tracking script is loaded on every page of the site.

== Frequently Asked Questions ==

= Does the plugin collect data from my visitors? =

The plugin by itself collects nothing. When configured, it loads a script that records the source (UTM/campaign) of visitors who interact with your buttons and forms, for lead attribution. Nothing is loaded until the identifier is configured.

= Do I need to configure anything manually? =

Usually not. The platform sets the identifier remotely, with your authorization (a WordPress application password). You can also set it manually if you prefer.

= How do I remove the tracking? =

Deactivate the plugin, or clear the account identifier.

== Changelog ==

= 1.0.0 =
* Initial version: enqueues the tracking script on the site when the account identifier is configured.
