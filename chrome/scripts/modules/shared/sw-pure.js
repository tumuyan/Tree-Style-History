// Pure helpers shared with the Service Worker via background-utils.js.
//
// These used to live inside background-sw.js. They are pure: no localStorage,
// no chrome.*, no DOM, no module-level state that outlives a worker. Keeping
// them in the shared bottom layer means the generator flattens them into the
// classic script the worker loads, and the page-side tests can exercise them
// as ES modules without booting a whole worker.
//
// Deliberately NOT here: the storage wrappers (getNegativeCache / setNegative-
// Cache / restoreCrawlState / saveCrawlState) and the heat-map writers. They
// read globals and session storage, so they stay in background-sw.js where the
// source guards can see the one-read / one-write shape.

import { INTERNAL_URL } from './url.js';

/** Drop the oldest entries until `cache` is back under `max`. */
export function evictOldest(cache, max) {
    var keys = Object.keys(cache);
    var excess = keys.length - max;
    for (var i = 0; i < excess; i++) delete cache[keys[i]];
    return cache;
}

/**
 * Drop entries older than `ttl` (relative to `now`) from `cache`.
 *
 * Returns how many were removed, so the caller can decide whether the
 * resulting object is worth persisting. `cache` is mutated in place.
 */
export function dropExpired(cache, now, ttl) {
    var keys = Object.keys(cache);
    var expired = 0;
    for (var i = 0; i < keys.length; i++) {
        if (now - cache[keys[i]] > ttl) {
            delete cache[keys[i]];
            expired++;
        }
    }
    return expired;
}

/**
 * How many whole-day buckets in `map` ended before `boundary`.
 *
 * The caller deletes them; keeping the deletion there preserves the live
 * `calendar_storage2` binding (calendar.js holds the same object). Only the
 * arithmetic — which keys are stale — is pure.
 */
export function expiredDayKeys(map, boundary) {
    var stale = [];
    for (var key of Object.keys(map)) {
        if (Number(key) < boundary) stale.push(key);
    }
    return stale;
}

/**
 * Validate one stored crawl-state object into the current shape.
 *
 * Pure: the caller does the single area.get() and hands over the result. The
 * rules (unknown version discarded wholesale, cursor/sweep TTLs, orphan and
 * junk counts dropped) are easier to test here than through a stubbed worker.
 */
export function normalizeCrawlState(saved, now, version, cursorTtl, sweepTtl) {
    const empty = { v: version, cursor: null, heat: {}, sweepAt: 0 };
    if (!saved || saved.v !== version) return empty;

    const c = saved.cursor;
    const cursor = (c && Number.isFinite(c.at) && now - c.at <= cursorTtl)
        ? { id: String(c.id), pos: Number(c.pos) || 0, at: c.at }
        : null;
    const sweepAt = (Number.isFinite(saved.sweepAt) && now - saved.sweepAt <= sweepTtl)
        ? saved.sweepAt : 0;

    // Counts belong to the walk the cursor describes: with no live cursor they
    // are orphans and are dropped, so a later checkpoint in a new window cannot
    // add them to its own sum.
    const heat = {};
    if (cursor && saved.heat && typeof saved.heat === 'object') {
        for (const key of Object.keys(saved.heat)) {
            const n = Number(saved.heat[key]);
            if (Number.isFinite(n) && n > 0) heat[key] = n;
        }
    }
    return { v: version, cursor: cursor, heat: heat, sweepAt: sweepAt };
}

/**
 * Where a pass resumes, from a state object and the rebuilt URL queue.
 *
 * The cursor's stored position is deliberately NOT a fallback: it indexed the
 * list as it stood when written, and that list is rebuilt on every start. An id
 * that has left the queue means those URLs were walked, so start at 0 and keep
 * the counted days (`resumed: true`).
 */
export function resumeIndexFrom(state, queue) {
    const cursor = state.cursor;
    if (!cursor) return { start: 0, resumed: false };
    const i = queue.findIndex(function (u) {
        return String(u.id) === String(cursor.id);
    });
    if (i >= 0) return { start: i + 1, resumed: true };
    return { start: 0, resumed: true };
}

/**
 * Count one visit towards its day in `days`.
 *
 * Browser-internal pages are skipped by the same title/url rule add_urls()
 * uses to decide what belongs in the database, so the heat square says what
 * the tree below it can show. `dayKey` is injected (the shared calendar module
 * owns the 23:59:59.999 contract) rather than imported, to keep this layer
 * dependency-free.
 */
export function countHeatVisitInto(days, v, urlItem, dayKey) {
    const title = urlItem.title;
    const url = urlItem.url;
    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(title)) return;
    if ((/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(url)) return;
    const key = dayKey(v.visitTime);
    days[key] = (days[key] || 0) + 1;
}

/**
 * Whether `url` was produced by one of the configured favicon services.
 *
 * `patterns` is injected rather than imported: the list of hosts lives in
 * background-sw.js, where the e2e suite reads it back out of the source to
 * abort exactly those requests before they leave the browser. A copy here
 * would let the two drift.
 */
export function matchFaviconService(url, patterns) {
    if (typeof url !== 'string') return false;
    for (var i = 0; i < patterns.length; i++) {
        if (url.indexOf(patterns[i]) !== -1) return true;
    }
    return false;
}

/**
 * The hostname a favicon-service URL is asking about, or null.
 *
 * The inverse of getFaviconUrl(): each service encodes the target in a
 * different part of the URL. Used for the cross-service shared cache key, so
 * a hostname cached from one service can answer another's fallback request.
 * Pure — the caller decides what to do with null (no shared cache entry).
 */
export function faviconServiceHostname(url) {
    try {
        var u = new URL(url);
        // DuckDuckGo: icons.duckduckgo.com/ip3/{hostname}.ico
        if (u.hostname === 'icons.duckduckgo.com') {
            var m = url.match(/\/ip3\/([^\/?]+)\.ico/);
            if (m) return m[1];
        }
        // Favicon.im: favicon.im/{hostname}
        if (u.hostname === 'favicon.im') {
            m = url.match(/favicon\.im\/([^\/?]+)/);
            if (m) return m[1];
        }
        // FaviconKit: ico.faviconkit.net/favicon/{hostname}
        if (u.hostname === 'ico.faviconkit.net') {
            m = url.match(/\/favicon\/([^\/?]+)/);
            if (m) return m[1];
        }
        // FaviconSnap: faviconsnap.com/api/favicon?url=...
        if (u.hostname === 'faviconsnap.com') {
            var du = u.searchParams.get('url');
            if (du) return new URL(decodeURIComponent(du)).hostname;
        }
        // Google: www.google.com/s2/favicons?domain_url=...
        if (u.hostname === 'www.google.com') {
            du = u.searchParams.get('domain_url');
            if (du) return new URL(decodeURIComponent(du)).hostname;
        }
    } catch {
        // null is the documented answer for "not one of ours"; every caller
        // handles it. Logging here would fire for every malformed URL.
    }
    return null;
}

/**
 * Rank chrome.history rows into the most-visited cache order.
 *
 * Three rules that are easy to get subtly wrong and used to be buried in a
 * callback: drop rows outside the recent window, order by visitCount desc,
 * and stop at `max`. Internal pages are filtered by the same shared regex the
 * rest of the extension uses, so the cache cannot disagree with the popup's
 * recent list about what counts as "browsing".
 *
 * The rows are returned unshaped: getFaviconUrl() is not pure, so the worker
 * decorates each one with its favicon URL after the ranking. Filtering before
 * sorting is equivalent to the old "sort, then take the first `max`
 * acceptable rows": both yield the first `max` acceptable rows in
 * visitCount order.
 */
export function rankMostVisited(items, cutoff, max) {
    const kept = [];
    for (const h of items) {
        if (!h || h.lastVisitTime < cutoff) continue;
        if (INTERNAL_URL.test(h.url)) continue;
        if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(h.title)) continue;
        kept.push(h);
    }
    kept.sort(function (a, b) { return b.visitCount - a.visitCount; });
    return kept.slice(0, max);
}

/**
 * Transitions that start a navigation rather than follow a link, so the
 * visit has no parent even when the browser supplied a referringVisitId.
 *
 * The same four-string test was written out twice in the worker
 * (crawlUrlVisits / add_tab_history); one of them gaining a fifth value
 * would have made the tree disagree with itself.
 */
export function isNavigatingTransition(transition) {
    return transition == 'typed' || transition == 'auto_bookmark' ||
        transition == 'keyword' || transition == 'keyword_generated';
}
