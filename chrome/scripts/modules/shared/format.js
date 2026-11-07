// Shared formatting / i18n helpers — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.

export var DAY = 24 * 3600 * 1000;

// How far back "recent" reaches, in days. Shared because two runtimes ask the
// same question with the same answer: the popup filters its recent-history list
// by it, and the Service Worker filters the most-visited candidates by it.
// Declared with `var`, not `const`: gen-sw-utils.mjs emits `/* exported ... */`
// for the Service Worker's benefit, and that directive only covers `var`.
export var RECENT_HISTORY_DAYS = 28;

// How many most-visited entries are kept in `mv-cache`. Shared for the same
// reason: the Service Worker fills the cache up to this many rows and the popup
// walks exactly this many of them, so the two must agree or the list silently
// loses its tail.
export var MOST_VISITED_MAX = 45;

// chrome.storage.session key the worker mirrors the live tab list into, and
// the shape version recorded alongside it. The worker writes it and the popup
// reads it, so — like the two constants above — they must not disagree, and
// both read the same declaration instead of a comment saying "keep in sync".
export var TAB_LIST_KEY = 'tab-list';
export var TAB_LIST_VERSION = 1;

// Midnight today. `TimeToStr()` rolls it forward when a page stays open past
// midnight, so it is mutable state and must live in exactly one module.
export var _DATE = new Date();
_DATE.setHours(0);
_DATE.setMinutes(0);
_DATE.setSeconds(0);
_DATE.setMilliseconds(0);

// Roll `_DATE` forward to today's midnight. Exported as a function because an
// ESM import is a read-only binding: callers cannot assign to `_DATE`
// themselves. Note `new Date(...)` around the addition — a bare `_DATE + DAY`
// coerces the Date to a *string*, which then breaks `_DATE.getTime()`.
//
// Only the page side needs this: a page can stay open across midnight, while
// the Service Worker is torn down after ~30s and re-evaluates `_DATE` on every
// start. The Service Worker therefore never calls it, but it lives here so
// there is still exactly one mutable `_DATE` in the codebase.
//
// `now` is injectable purely so the roll-over can be tested without waiting
// for midnight (see tests/shared.test.mjs).
export function advanceDateToToday(now) {
    const current = now === undefined ? new Date() : now;
    while (current - _DATE > DAY) {
        _DATE = new Date(_DATE.getTime() + DAY);
    }
}

export function getVersion() {
    // Directly get version from manifest.json
    return chrome.runtime.getManifest().version;
}

export function getVersionType() {
    return 'browserAction';
}

export function returnLang(str) {
    return chrome.i18n.getMessage(str);
}

export function timeNow(st) {
    var tf = storageAdapter.getItem('rh-timeformat');
    var currentTime = st === 0 ? new Date() : new Date(st);
    var hours = currentTime.getHours();
    var minutes = currentTime.getMinutes();
    var te = '';

    if (tf == '12') {
        if (hours > 11) {
            te = ' ' + returnLang('PM');
        } else {
            te = ' ' + returnLang('AM');
        }
        if (hours == 0) {
            hours = 12;
        }
        if (hours > 12) {
            hours = hours - 12;
        }
    }

    if (hours < 10) {
        hours = '0' + hours;
    }
    if (minutes < 10) {
        minutes = '0' + minutes;
    }

    return hours + ':' + minutes + te;
}
