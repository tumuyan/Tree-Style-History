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
