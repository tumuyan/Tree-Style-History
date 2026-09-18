// Shared URL parsing helpers — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.

export function isBookmarkletUrl(url) {
    if (typeof url !== 'string') return false;
    return /^javascript\s*:/i.test(url.trim());
}

// URL schemes that are not "where you were browsing": local files, the file
// transfer protocols, and the browser's own pages.
//
// One regex because two lists answer the same question twice: the Service
// Worker uses it to keep these out of the most-visited cache, and the popup
// uses it to keep them out of recent history. Let them drift and a page shows
// up in one list but not the other.
//
// Declared with `var`, not `const`: gen-sw-utils.mjs emits `/* exported ... */`
// for the Service Worker's benefit, and that directive only covers `var`.
export var INTERNAL_URL = /^(ftp|ftps|file|chrome|chrome-extension|chrome-devtools|edge)\:\/\//;

export function get_host(url) {
    try {
        var parsed = new URL(url);
        var host = parsed.hostname;
        if (host) return host;
    } catch {
        try {
            parsed = new URL('https://' + url);
            host = parsed.hostname;
            if (host && host.indexOf('.') !== -1) return host;
        } catch {}
    }
    return "#";
}
