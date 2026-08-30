// Shared calendar storage helper — single source of truth for background-utils.js.
//
// Part of `modules/shared/`: the dependency-free bottom layer mechanically
// concatenated (minus import/export markers) into `scripts/background-utils.js`
// by `scripts/gen-sw-utils.mjs`. Do NOT edit the generated file by hand.
//
// Load-order contract: `onStorageReady()` is called unconditionally at import
// time, so `storage-adapter.js` must already have run. Every consumer honours
// this — pages load it before the module bundle, and background-sw.js has
// `importScripts('storage-adapter.js')` first.

import { _DATE } from './format.js';

export var calendar_storage2 = {};
onStorageReady(function() {
    var calendar_storage2_str = localStorage['calendar-storage2'];
    if (calendar_storage2_str != undefined) {
        try {
            calendar_storage2 = JSON.parse(calendar_storage2_str);
        } catch (error) {
            console.warn('Failed to parse calendar-storage2', error);
            calendar_storage2 = {};
        }
    }
});

export function save_calendar_storage2(obj, n, f) {
    if (obj['text'] == '' && obj['maxResults'] >= 9999 && obj['endTime'] - 86400000 == obj['startTime']) {
        if ((obj['startTime'] - _DATE + 1) % 86400000 == 0) {
            if (f || calendar_storage2[obj['startTime']] == undefined || calendar_storage2[obj['startTime']] < 1) {
                calendar_storage2[obj['startTime']] = n;
                console.log('n=' + n);
                localStorage['calendar-storage2'] = JSON.stringify(calendar_storage2);
            }
        }
    }
}
