// Shared calendar storage helper — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.
//
// Load-order contract: `onStorageReady()` is called unconditionally at import
// time and a `chrome.storage.onChanged` listener is registered, so
// `storage-adapter.js` must already have run. Every consumer honours this —
// pages load it before the module bundle, and background-sw.js has
// `importScripts('storage-adapter.js')` first.

import { DAY } from './format.js';

// `{ <day end, as epoch ms>: <row count> }` — one entry per day.
//
// The key is the *inclusive end* of the day's window, i.e. the cell's own
// date at 23:59:59.999. Every writer and reader in the codebase is built on
// that value (calendar.js builds each cell from `new Date(y, m, d - 1, 23,59,59,999)`
// and both search queries end at `dayEnd`), so it is a contract, not an
// implementation detail. `dayKey()` below converts an arbitrary instant into
// it.
export var calendar_storage2 = {};

/**
 * Rebuild the parsed map from a stored value, in place.
 *
 * The object's identity is deliberately kept: `calendar_storage2` is a live
 * ESM binding imported by calendar.js and a global the worker reads, and a
 * render (or a test) may be holding the object it was handed. Replacing it
 * would leave those readers on a stale map. Clearing and refilling gives the
 * same contents without breaking them.
 *
 * `raw` is either the JSON string the writers store (an object is tolerated,
 * for a value written straight through chrome.storage.local) or undefined for
 * a removed key.
 */
function hydrateCalendarStorage(raw) {
    var parsed = {};
    if (raw != null) {
        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch (error) {
                console.warn('Failed to parse calendar-storage2', error);
                raw = null;
            }
        }
        if (raw != null && typeof raw === 'object') parsed = raw;
    }
    var oldKeys = Object.keys(calendar_storage2);
    for (var i = 0; i < oldKeys.length; i++) delete calendar_storage2[oldKeys[i]];
    var newKeys = Object.keys(parsed);
    for (var j = 0; j < newKeys.length; j++) calendar_storage2[newKeys[j]] = parsed[newKeys[j]];
}

onStorageReady(function() {
    hydrateCalendarStorage(localStorage['calendar-storage2']);
});

// storage-adapter mirrors other contexts' writes into the localStorage cache,
// but the *parsed* map is a separate copy. Both writers (the page's
// save_calendar_storage2() and the worker's saveCrawledHeat()) serialise their
// own map over the whole key, so without this listener a write from one
// context is erased by the other's next flush.
//
// `change.newValue` is the exact value that just landed — using it instead of
// the localStorage cache means this does not depend on storage-adapter's own
// onChanged listener having run first. A removal carries no newValue and means
// the map is empty.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local') return;
        var change = changes['calendar-storage2'];
        if (!change) return;
        hydrateCalendarStorage('newValue' in change ? change.newValue : undefined);
    });
}

/**
 * The heat map's key for the day `t` falls on: `t`'s date at 23:59:59.999.
 *
 * Note this is the day's *end*, not its midnight. A day's window is written as
 * `[dayEnd - DAY, dayEnd]` — an inclusive end — and calendar.js looks each cell
 * up with the same expression. Deriving the key from the window's *start*
 * instead would shift every entry back by one day, because a window ending at
 * today 23:59:59 starts at yesterday 23:59:59.
 */
export function dayKey(t) {
    var d = new Date(t);
    d.setHours(23);
    d.setMinutes(59);
    d.setSeconds(59);
    d.setMilliseconds(999);
    return d.getTime();
}

/**
 * Record how many history rows fall on the day covered by `obj`.
 *
 * `obj` is a `chrome.history.search` query: the half-open window it describes
 * is `[startTime, endTime]` and it must be exactly one day long. `n` is the
 * count of rows in that window, i.e. for `dayKey(obj.endTime)`.
 *
 * `overwrite: true` — the caller just counted this day itself and its number
 * is the newer one, so it replaces whatever is stored.
 *
 * That is the only call shape left, and it is deliberate: the single caller is
 * history(), which is displaying the day. The day it displays *is* today, and
 * today is the one day the Service Worker cannot speak for — the crawl only
 * ever walks history that already existed when it ran, while the page counts
 * the day right now. So the page overwrites, and the crawl's back-fill writes
 * only where the map has nothing (see saveCrawledHeat() in background-sw.js;
 * it does not come through here).
 *
 * `overwrite: false` is still supported and means "only fill in a day that has
 * no usable value yet" — a gap-filler for a caller that is *not* authoritative
 * about the day it hands over. Do not delete the branch as dead code, and do
 * not call it from the crawl: the two writers would then race for the same day
 * with numbers measured differently (visits vs rows).
 *
 * Returns true when the map actually changed.
 *
 * The old signature was `(obj, n, f)` and carried a `obj['maxResults'] >= 9999`
 * guard as a proxy for "this is a full-day sample". The Service Worker used to
 * query with `maxResults: 0` ("unlimited"), which is *the same intent* but fails
 * `>= 9999` — so every Service Worker write was discarded and the heat map was
 * only ever painted by clicking a day. Do not reintroduce a guard on a field
 * whose meaning differs between callers; validate the day window only.
 */
export function save_calendar_storage2(obj, n, overwrite) {
    if (obj == undefined || obj['text'] != '' || obj['endTime'] == undefined || obj['startTime'] == undefined) {
        return false;
    }
    if (obj['endTime'] - obj['startTime'] != DAY) {
        return false;
    }

    // Keyed by the window's end, which is the day the window covers — see the
    // comment on the map declaration.
    var key = dayKey(obj['endTime']);
    // A day with no rows holds no information: the calendar draws an uncoloured
    // cell for a missing key and for a 0 alike. Not storing it keeps the map
    // from growing an entry per day forever — one key per day, never cleaned
    // up, is thousands of dead entries after a few years, all of them 0.
    if (n < 1) {
        // Still an edit worth making when the count used to be non-zero (the
        // user cleared that day's history): the stale entry would otherwise
        // keep the cell coloured.
        if (calendar_storage2[key] == undefined) return false;
        delete calendar_storage2[key];
        localStorage['calendar-storage2'] = JSON.stringify(calendar_storage2);
        return true;
    }

    if (!overwrite && calendar_storage2[key] != undefined && calendar_storage2[key] > 0) {
        return false;
    }
    if (calendar_storage2[key] === n) {
        return false;
    }

    calendar_storage2[key] = n;
    localStorage['calendar-storage2'] = JSON.stringify(calendar_storage2);
    return true;
}

/**
 * Colour bucket for a day's row count: 0 = uncoloured.
 *
 * Extracted so the calendar and any other surface agree on the tiers; the
 * thresholds used to be written out twice (once per branch of calendar.js) and
 * a third time inline in history-core.js.
 */
export function calendarLevel(n) {
    if (n == undefined || n < 1) return 0;
    if (n < 50) return 1;
    if (n < 100) return 2;
    if (n < 150) return 3;
    return 4;
}
