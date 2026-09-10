// Shared favicon URL resolver — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.

import { get_host, isBookmarkletUrl } from './url.js';
import { defaultValues } from './config-defaults.js';

export function getFaviconUrl(url, options) {
    options = options || {};
    if (!url || typeof url !== 'string') {
        return Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : '';
    }
    if (isBookmarkletUrl(url)) {
        return Object.prototype.hasOwnProperty.call(options, 'bookmarkletFallback') ? options.bookmarkletFallback : 'images/iconmonstr-script-6.svg';
    }
    if (url.indexOf('extension://') !== -1 || url.indexOf('edge://extensions') !== -1) {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                return url.indexOf(chrome.runtime.id) !== -1 ? 'images/tree-38.png' : 'images/Extension-icon-vector-04.svg';
            }
        } catch {}
        return 'images/Extension-icon-vector-04.svg';
    }
    if (url.indexOf('chrome://') === 0 || url.indexOf('about:') === 0 || url.indexOf('edge://') === 0 || url.indexOf('opera://') === 0 || url.indexOf('brave://') === 0) {
        return 'images/Browser-icon-vector-03.svg';
    }
    if (url.indexOf('file://') === 0) {
        return 'images/iconmonstr-file-3.svg';
    }
    var service = options.service || localStorage['favicon-service'] || defaultValues['favicon-service'];
    var trimmedUrl = url.trim();
    if (!trimmedUrl) return Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : '';
    var hostValue = '#';
    try { hostValue = get_host(trimmedUrl); } catch { hostValue = '#'; }
    if (service === 'chrome') {
        return hostValue === '#' ? 'chrome://favicon/' : 'chrome://favicon/' + trimmedUrl;
    }
    var parsedUrl = null;
    try { parsedUrl = new URL(trimmedUrl); }
    catch {
        try { parsedUrl = new URL('https://' + trimmedUrl); }
        catch { parsedUrl = null; }
    }
    var fallback = Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : 'images/blank.png';
    if (!parsedUrl || hostValue === '#') return fallback;
    var protocol = parsedUrl.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return fallback;
    var hostname = parsedUrl.hostname;
    if (!hostname) return fallback;
    if (service === 'google') return 'https://www.google.com/s2/favicons?sz=64&domain_url=' + encodeURIComponent(parsedUrl.origin + '/');
    if (service === 'duckduckgo') return 'https://icons.duckduckgo.com/ip3/' + hostname + '.ico';
    if (service === 'favicon_im') return 'https://favicon.im/' + hostname + '?throw-error-on-404=true';
    if (service === 'faviconkit') return 'https://ico.faviconkit.net/favicon/' + hostname + '?sz=64';
    if (service === 'faviconsnap') return 'https://faviconsnap.com/api/favicon?url=' + encodeURIComponent(parsedUrl.origin + '/') + '&size=64';
    return 'chrome://favicon/' + trimmedUrl;
}

// Generate onerror attribute for favicon img fallback to secondary service.
export function getFaviconOnerror(url) {
    var fallbackService = localStorage['favicon-service-fallback'] || '';
    if (!fallbackService) return '';
    return getFaviconUrl(url, { service: fallbackService });
}
