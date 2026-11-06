// Behaviour tests for the pure SW helpers in modules/shared/sw-pure.js.
//
// These used to be inline in background-sw.js, reachable only through a whole
// worker boot with stubbed chrome.* / IndexedDB. As shared pure functions they
// can be imported directly: no storage, no timers, no worker. The source guards
// still pin that the worker calls them; these cover the answers themselves.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    evictOldest, dropExpired, expiredDayKeys,
    normalizeCrawlState, resumeIndexFrom, countHeatVisitInto,
} from '../chrome/scripts/modules/shared/sw-pure.js';

const VERSION = 1;
const CURSOR_TTL = 6000;
const SWEEP_TTL = 60000;
const NOW = 1000000;

test('evictOldest drops the oldest entries and keeps the cache at the cap', () => {
    const cache = {};
    for (let i = 0; i < 6; i++) cache['u' + i] = i;
    evictOldest(cache, 3);
    assert.deepEqual(Object.keys(cache), ['u3', 'u4', 'u5'],
        'insertion order decides who goes, so the newest survive');
});

test('evictOldest is a no-op below the cap', () => {
    const cache = { a: 1, b: 2 };
    evictOldest(cache, 5);
    assert.deepEqual(Object.keys(cache), ['a', 'b']);
});

test('dropExpired removes only entries past the TTL and reports how many', () => {
    const cache = {
        fresh: NOW - 100,
        stale: NOW - 5000,
        ancient: NOW - 9000,
    };
    assert.equal(dropExpired(cache, NOW, 4000), 2);
    assert.deepEqual(Object.keys(cache), ['fresh']);
});

test('expiredDayKeys finds whole-day buckets that ended before the boundary', () => {
    // dayKey-shaped keys: 23:59:59.999 of each day. The boundary is the
    // cutoff day's 00:00:000, so that day's own key (later) survives.
    const dayEnd = (d) => d * 86400000 + 86399999;
    const map = { [dayEnd(0)]: 1, [dayEnd(1)]: 2, [dayEnd(2)]: 3 };
    const boundary = 2 * 86400000; // day 2 at 00:00
    assert.deepEqual(expiredDayKeys(map, boundary).map(Number),
        [dayEnd(0), dayEnd(1)], 'both days ending before the boundary are stale');
});

test('normalizeCrawlState discards an unknown version wholesale', () => {
    const saved = { v: 99, cursor: { id: 'x', pos: 3, at: NOW }, heat: { k: 5 }, sweepAt: NOW };
    assert.deepEqual(normalizeCrawlState(saved, NOW, VERSION, CURSOR_TTL, SWEEP_TTL),
        { v: VERSION, cursor: null, heat: {}, sweepAt: 0 });
});

test('normalizeCrawlState drops orphan counts when there is no live cursor', () => {
    const saved = { v: VERSION, cursor: null, heat: { k: 5 }, sweepAt: NOW - 10 };
    assert.deepEqual(normalizeCrawlState(saved, NOW, VERSION, CURSOR_TTL, SWEEP_TTL).heat, {},
        'counts only mean something beside the walk that gathered them');
});

test('normalizeCrawlState drops junk counts and keeps finite positive ones', () => {
    const saved = {
        v: VERSION,
        cursor: { id: 'x', pos: 2, at: NOW - 10 },
        heat: { good: 3, nan: 'x', zero: 0, negative: -2 },
        sweepAt: 0,
    };
    assert.deepEqual(normalizeCrawlState(saved, NOW, VERSION, CURSOR_TTL, SWEEP_TTL).heat,
        { good: 3 });
});

test('an expired cursor takes its heat with it, and an old sweep is not trusted', () => {
    const saved = {
        v: VERSION,
        cursor: { id: 'x', pos: 2, at: NOW - CURSOR_TTL - 1 },
        heat: { k: 5 },
        sweepAt: NOW - SWEEP_TTL - 1,
    };
    const out = normalizeCrawlState(saved, NOW, VERSION, CURSOR_TTL, SWEEP_TTL);
    assert.equal(out.cursor, null);
    assert.deepEqual(out.heat, {});
    assert.equal(out.sweepAt, 0);
});

test('resumeIndexFrom finds the cursor id, ignoring the stored position', () => {
    const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(resumeIndexFrom({ cursor: { id: 'b', pos: 99 } }, queue),
        { start: 2, resumed: true });
});

test('an id that left the queue resumes from the top and keeps the counts', () => {
    const queue = [{ id: 'c' }, { id: 'd' }];
    assert.deepEqual(resumeIndexFrom({ cursor: { id: 'missing', pos: 99 } }, queue),
        { start: 0, resumed: true });
});

test('no cursor is a fresh pass', () => {
    assert.deepEqual(resumeIndexFrom({ cursor: null }, [{ id: 'a' }]),
        { start: 0, resumed: false });
});

const dayKey = (t) => t; // identity keeps the assertion about the counting rule

test('countHeatVisitInto counts a real visit and skips internal pages', () => {
    const days = {};
    countHeatVisitInto(days, { visitTime: 111 }, { title: 'Docs', url: 'https://a.test/' }, dayKey);
    assert.deepEqual(days, { 111: 1 });

    // A title that is itself a browser-internal URL is not a history row —
    // even when the URL column looks like an ordinary page, so only the TITLE
    // filter can catch it (a mutant that drops just that branch turns red).
    countHeatVisitInto(days, { visitTime: 222 },
        { title: 'chrome://history/', url: 'https://a.test/page' }, dayKey);
    assert.equal(days[222], undefined, 'a title naming an internal page must not colour a day');

    // The URL filter is the other half: an internal scheme in the URL column.
    countHeatVisitInto(days, { visitTime: 333 },
        { title: 'Docs', url: 'file:///tmp/x' }, dayKey);
    assert.equal(days[333], undefined, 'an internal URL scheme must not colour a day');
});
