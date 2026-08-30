// Shared URL parsing helpers — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.

export function isBookmarkletUrl(url) {
    if (typeof url !== 'string') return false;
    return /^javascript\s*:/i.test(url.trim());
}

export function get_host(url) {
    try {
        var parsed = new URL(url);
        var host = parsed.hostname;
        if (host) return host;
    } catch (e) {
        try {
            var parsed = new URL('https://' + url);
            var host = parsed.hostname;
            if (host && host.indexOf('.') !== -1) return host;
        } catch (e2) {}
    }
    return "#";
}
