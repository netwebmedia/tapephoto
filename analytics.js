/* TapePhoto — analytics loader.
 *
 * THE ONLY PLACE THE GA4 ID LIVES. Every page loads this file from <head>;
 * to turn analytics on, create a GA4 property at analytics.google.com and put
 * its Measurement ID (looks like "G-XXXXXXXXXX") on the line below. Nothing
 * else needs to change anywhere on the site.
 *
 * While GA4_ID is empty this file is a deliberate no-op: no network request,
 * no cookie, no console noise. That keeps the site clean (and cookie-banner
 * free) until there is actually a property to report into.
 *
 * Conversion events are fired from main.js — see trackEvent() there. The one
 * that matters is `generate_lead`; mark it as a key event in GA4 once data
 * starts arriving.
 */
(function () {
    'use strict';

    var GA4_ID = ''; // <-- put "G-XXXXXXXXXX" here to activate

    window.TAPEPHOTO_GA4_ID = GA4_ID;

    if (!GA4_ID) {
        // No property yet. Define a harmless stub so main.js can call
        // window.gtag() unconditionally without feature-checking everywhere.
        window.gtag = window.gtag || function () {};
        return;
    }

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // Chilean visitors: keep IP anonymisation on by default.
    window.gtag('config', GA4_ID, { anonymize_ip: true });

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
})();
