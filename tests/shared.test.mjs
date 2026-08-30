// Behaviour tests for `chrome/scripts/modules/shared/` — the dependency-free
// bottom layer that is also flattened into background-utils.js.
//
// These modules are imported statically (not via `await import(...)` like the
// ones in modules.test.mjs) because they have no import-time side effects:
// they never touch `chrome`, `localStorage` or `document`, and only
// `calendar-storage.js` calls `onStorageReady()` — which is why it is not
// exercised here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { _DATE, DAY, advanceDateToToday } from '../chrome/scripts/modules/shared/format.js';

// `_DATE` is a live binding, so a test cannot assign to it. The roll-over is
// therefore driven forwards: `advanceDateToToday()` accepts an injectable
// "now", which lets this run at any time of day.
//
// The bug this pins down: the pre-refactor `TimeToStr()` rolled the date with
// `_DATE = _DATE + DAY`, which coerces the Date to a *string*. The next
// iteration then compared `NaN > DAY` (false), so the loop exited having left
// `_DATE` a string — and every later `_DATE.getTime()` threw a TypeError,
// once a day, on every page.
test('advanceDateToToday rolls _DATE forward as a Date, never as a string', () => {
    const start = _DATE.getTime();

    // It really is midnight, not "whenever the module was imported".
    const midnight = new Date(start);
    assert.equal(midnight.getHours(), 0);
    assert.equal(midnight.getMinutes(), 0);
    assert.equal(midnight.getSeconds(), 0);
    assert.equal(midnight.getMilliseconds(), 0);

    // Still the same day: nothing moves.
    advanceDateToToday();
    assert.equal(_DATE.getTime(), start, 'no roll-over while it is still today');

    // Jump three days ahead. This is the branch the old code corrupted.
    advanceDateToToday(new Date(Date.now() + 3 * DAY));
    assert.ok(_DATE instanceof Date, '_DATE must stay a Date after rolling over');
    assert.equal(_DATE.getTime(), start + 3 * DAY, 'expected _DATE to advance by exactly 3 days');

    // Idempotent: re-running at the same instant must not keep moving it.
    const settled = _DATE.getTime();
    advanceDateToToday(new Date(Date.now() + 3 * DAY));
    assert.equal(_DATE.getTime(), settled, 'roll-over must be idempotent');
});

test('DAY is one day in milliseconds', () => {
    assert.equal(DAY, 86400000);
});
