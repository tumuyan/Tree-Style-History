// Shared formatting / i18n helpers — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.

export var DAY = 24 * 3600 * 1000;

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
    var tf = localStorage['rh-timeformat'];
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
