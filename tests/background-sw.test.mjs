// Behaviour tests for chrome/scripts/background-sw.js
//
// Same technique as db-manager.test.mjs: the file is a classic script that
// publishes nothing but globals, so it is evaluated in a fresh node:vm context
// with just enough of `chrome` faked to drive the real control flow.
//
// Deliberately NOT loaded:
//   storage-adapter.js — replaced by a queueing `onStorageReady` and a plain
//     object standing in for `localStorage`, so each test decides when the
//     worker starts instead of racing its own assertions.
//   db-manager.js — replaced by a recording stub; the crawl tests only need to
//     count what reached it, not a working IndexedDB.
// background-utils.js IS loaded for real. It is a generated file now, and the
// worker is the only consumer, so this is one of the few places that exercise
// it the way it is actually used.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SCRIPTS = new URL('../chrome/scripts/', import.meta.url);
const SW_SRC = fs.readFileSync(new URL('background-sw.js', SCRIPTS), 'utf8');
const UTILS_SRC = fs.readFileSync(new URL('background-utils.js', SCRIPTS), 'utf8');

// `const`s in a script do not become properties of the vm context, so the cap
// is read back out of the source: hard-coding 1000 here would let the two
// drift apart silently.
const SESSION_ID_LIMIT = Number(/const SESSION_ID_LIMIT = (\d+)/.exec(SW_SRC)[1]);
const CRAWL_CHECKPOINT_URLS = Number(/const CRAWL_CHECKPOINT_URLS = (\d+)/.exec(SW_SRC)[1]);

function makeArea(map) {
    return {
        get(keys, cb) {
            const out = {};
            if (keys === null || keys === undefined) {
                for (const [k, v] of map) out[k] = v;
            } else {
                for (const k of (Array.isArray(keys) ? keys : [keys])) {
                    if (map.has(k)) out[k] = map.get(k);
                }
            }
            if (cb) cb(out);
            return Promise.resolve(out);
        },
        set(obj, cb) {
            for (const [k, v] of Object.entries(obj)) map.set(k, v);
            if (cb) cb();
            return Promise.resolve();
        },
        remove(keys, cb) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) map.delete(k);
            if (cb) cb();
            return Promise.resolve();
        },
        clear(cb) { map.clear(); if (cb) cb(); return Promise.resolve(); },
    };
}

/**
 * Default chrome.history.getVisits: one visit, answered a macrotask later so
 * that anything running alongside is observable.
 */
function defaultGetVisits(state, q, cb) {
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    setTimeout(function () {
        state.inFlight--;
        state.visitCounter++;
        cb([{
            visitId: state.visitCounter,
            visitTime: Date.now(),
            transition: 'link',
            referringVisitId: 0,
        }]);
    }, 0);
}

/**
 * `localStorage` with a counter on the favicon negative cache.
 *
 * That key is the whole cache as one JSON string, so counting the writes to
 * it is how the tests see the difference between "one write per failed icon"
 * and "one write per popup".
 */
function negLocalStorage(state) {
    const store = {};
    return Object.defineProperty({}, 'favicon-negative-cache', {
        enumerable: true,
        configurable: true,
        get() { return store['favicon-negative-cache']; },
        set(v) { state.negWrites++; store['favicon-negative-cache'] = String(v); },
    });
}

/**
 * Evaluate the worker in a fresh context.
 *
 * @param {object} [opts]
 * @param {Map}    [opts.sessionStore] shared between two workers to simulate
 *   a restart: chrome.storage.session is the only thing that outlives one.
 * @param {Array}  [opts.tabs] what chrome.tabs.query() reports.
 * @param {Function} [opts.getVisits] (state, query, callback) per-URL answers.
 */
function loadWorker(opts = {}) {
    const sessionStore = opts.sessionStore || new Map();
    const events = new Map();
    const readyCallbacks = [];

    const state = {
        tabs: opts.tabs || [],
        visits: [],
        urls: [],
        closed: [],
        badges: [],
        queried: [],
        errors: [],
        warnings: [],
        visitCounter: 0,
        inFlight: 0,
        maxInFlight: 0,
        // How many times the whole negative cache was re-serialised. It is one
        // JSON string in storage, so this — not the entry count — is what the
        // batching is buying.
        negWrites: 0,
        // Likewise how many times it was re-parsed, which is how the tests tell
        // a cached copy from a discarded one.
        jsonParses: 0,
    };

    const ev = (name) => ({
        addListener(fn) {
            if (!events.has(name)) events.set(name, []);
            events.get(name).push(fn);
        },
        removeListener(fn) {
            const list = events.get(name) || [];
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
        },
    });

    const getVisits = opts.getVisits || defaultGetVisits;

    // Overridable so a test can make session storage fail the two ways it
    // really fails: a rejected promise (over quota) and a synchronous throw
    // (a value that cannot be structured-cloned).
    const sessionArea = makeArea(sessionStore);
    if (opts.sessionOverrides) Object.assign(sessionArea, opts.sessionOverrides);

    const chrome = {
        runtime: {
            id: 'test-extension-id',
            lastError: undefined,
            getManifest: () => ({ version: '3.3.1', manifest_version: 3 }),
            onMessage: ev('runtime.onMessage'),
            onInstalled: ev('runtime.onInstalled'),
            onStartup: ev('runtime.onStartup'),
        },
        i18n: { getMessage: (key) => key, getUILanguage: () => 'en' },
        storage: {
            local: makeArea(new Map()),
            sync: makeArea(new Map()),
            session: sessionArea,
            // Recorded rather than discarded: the worker listens for the
            // options page clearing the favicon caches from another context.
            onChanged: ev('storage.onChanged'),
        },
        tabs: {
            query: (_q, cb) => cb(state.tabs),
            onCreated: ev('tabs.onCreated'),
            onUpdated: ev('tabs.onUpdated'),
            onActivated: ev('tabs.onActivated'),
            onRemoved: ev('tabs.onRemoved'),
        },
        history: {
            // @param opts.historyResults replaces this; mostVisitedInit() is
            // the one caller that reads what the real API would return.
            search: (_q, cb) => cb(opts.historyResults || []),
            getVisits: (q, cb) => {
                state.queried.push(q.url);
                // Called straight through: the worker wraps this in a Promise
                // executor, and a synchronous throw is how it finds out that
                // the API failed.
                getVisits(state, q, cb);
            },
        },
        alarms: { create() {}, onAlarm: ev('alarms.onAlarm') },
        action: { setBadgeText: (o) => state.badges.push(o.text) },
        contextMenus: {
            removeAll: (cb) => cb(),
            create: (_o, cb) => cb(),
            onClicked: ev('contextMenus.onClicked'),
        },
        commands: { onCommand: ev('commands.onCommand') },
    };

    const dbManager = {
        init: () => Promise.resolve({}),
        updateClosedTabsStatus: () => Promise.resolve(),
        putClosedTab: (r) => { state.closed.push(r); return Promise.resolve(r); },
        putVisitItem: (r) => { state.visits.push(r); return Promise.resolve(r); },
        putVisitItems: (rs) => { state.visits.push(...rs); return Promise.resolve(rs); },
        putURL: (r) => { state.urls.push(r); return Promise.resolve(r); },
        putURLs: (rs) => { state.urls.push(...rs); return Promise.resolve(rs); },
        queryURLs: () => Promise.resolve([]),
        deleteDB: () => Promise.resolve(),
    };

    const ctx = {
        chrome,
        dbManager,
        console: {
            log() {}, debug() {}, info() {},
            warn: (...a) => state.warnings.push(a.join(' ')),
            error: (...a) => state.errors.push(a.join(' ')),
        },
        setTimeout,
        clearTimeout,
        performance: { now: () => Date.now() },
        // Only used to build the query range in loadHistory(); the DB is a
        // stub, so no key range is ever interpreted.
        IDBKeyRange: { lowerBound: () => ({}), upperBound: () => ({}) },
        // `JSON.parse` is counted rather than stubbed: the negative cache is
        // one JSON string, and "was it parsed again" is the observable
        // difference between a cached copy and a discarded one.
        JSON: {
            parse: (text, reviver) => { state.jsonParses++; return JSON.parse(text, reviver); },
            stringify: (value, a, b) => JSON.stringify(value, a, b),
        },
        localStorage: negLocalStorage(state),
        caches: { open: async () => ({ match: async () => undefined, put: async () => {} }), delete: async () => true },
        Response: { error: () => ({}) },
        // The worker's own onStorageReady hook; nothing runs until boot().
        onStorageReady: (cb) => { readyCallbacks.push(cb); },
        addEventListener() {},
        importScripts: (...names) => {
            for (const name of names) {
                // db-manager.js is stubbed out above; see the header comment.
                if (name === 'db-manager.js' || name === 'storage-adapter.js') continue;
                new vm.Script(fs.readFileSync(new URL(name, SCRIPTS), 'utf8'), { filename: name })
                    .runInContext(ctx);
            }
        },
    };
    ctx.self = ctx;

    vm.createContext(ctx);
    new vm.Script(SW_SRC, { filename: 'background-sw.js' }).runInContext(ctx);
    // background-utils.js is pulled in by importScripts() in the real worker;
    // run it here so the generated file is part of what these tests cover.
    new vm.Script(UTILS_SRC, { filename: 'background-utils.js' }).runInContext(ctx);

    return {
        ctx,
        state,
        sessionStore,
        /** Start the worker the way onStorageReady does. */
        boot() { for (const cb of readyCallbacks.splice(0)) cb(); },
        /** Let pending promise chains and timers run. */
        async settle(turns = 12) {
            for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
        },
        fire(name, ...args) {
            for (const fn of events.get(name) || []) fn(...args);
        },
    };
}

// ---------------------------------------------------------------------------
// Session state
//
// The visit tree is built from `urlIdJson`: it is the only thing that says
// "the page this link was opened from is visit 12345". Losing it on every
// service worker recycle turns every subsequent link click into a root node.
// ---------------------------------------------------------------------------

test('tab state written by one worker is read by the next', async () => {
    const session = new Map();
    const first = loadWorker({ sessionStore: session, tabs: [] });
    first.boot();
    await first.settle();

    // A link opened in a new tab from the tab that is showing /parent/.
    first.fire('tabs.onUpdated', 3, { status: 'loading' }, { id: 3, url: 'https://parent/' });
    first.fire('tabs.onCreated', { id: 7, openerTabId: 3, url: 'https://child/' });
    first.fire('tabs.onActivated', { tabId: 3 });

    // Straight to storage rather than through the 1s debounce.
    await first.ctx.saveSessionState();
    assert.ok(session.has('tab-state'), 'the worker must leave a snapshot behind');

    // Second worker: same session storage, i.e. a recycle rather than a
    // browser restart.
    const second = loadWorker({
        sessionStore: session,
        tabs: [
            { id: 3, active: true, url: 'https://parent/', title: 'Parent' },
            { id: 7, active: false, url: 'https://child/', title: 'Child' },
        ],
    });
    second.boot();
    await second.settle();

    assert.equal(second.ctx.openerJson['7'], 'https://parent/',
        'the opener link must survive a service worker restart, or the visit tree is orphaned');
    assert.equal(second.ctx.tabUrlJson['3'], 'https://parent/');
    // Activation order is not recoverable from a live-tab query, so it has to
    // come from the snapshot.
    //
    // Array.from(): the array was built inside the vm context, so its
    // prototype is that realm's Array and deepEqual would reject it on
    // structure alone.
    assert.deepEqual(Array.from(second.ctx.recentTabs), [3]);
});

test('the tab list is mirrored into a key small enough for the popup', async () => {
    // The popup reads this instead of messaging the worker: a message wakes the
    // worker, and a worker that wakes runs the startup crawl again.
    const session = new Map();
    const w = loadWorker({ sessionStore: session, tabs: [] });
    w.boot();
    await w.settle();

    w.fire('tabs.onActivated', { tabId: 3 });
    w.fire('tabs.onActivated', { tabId: 7 });
    await w.ctx.saveSessionState();

    const list = session.get('tab-list');
    assert.ok(list, 'the popup needs a snapshot of its own to read');
    // Array.from(): built inside the vm context, so its prototype is that
    // realm's Array and deepEqual would reject it on structure alone.
    assert.deepEqual(Array.from(list.recentTabs), [7, 3],
        'activation order is the point of the snapshot: newest first');
    // The visit-id maps are what makes the full snapshot oversized; the popup
    // must not have to deserialise them on every open.
    assert.deepEqual(Object.keys(list).sort(), ['openedTabs', 'recentTabs', 'v'],
        'the popup copy carries the two tab fields and nothing else');
});

test('a stale full snapshot does not take the tab list down with it', async () => {
    // `tab-list` carries its own version, so bumping SESSION_STATE_VERSION must
    // not discard it as a side effect. Before this it sat behind the version
    // check: the next shape change would have quietly cost the popup the
    // activation order — the one thing a live-tab query cannot rebuild.
    const session = new Map();
    const first = loadWorker({ sessionStore: session, tabs: [] });
    first.boot();
    await first.settle();

    first.fire('tabs.onActivated', { tabId: 3 });
    first.fire('tabs.onActivated', { tabId: 7 });
    await first.ctx.saveSessionState();

    // Fake forward: what the next worker would find after a version bump.
    session.get('tab-state').v = 999;

    const next = loadWorker({ sessionStore: session, tabs: [] });
    next.boot();
    await next.settle();

    assert.equal(await next.ctx.restoreSessionState(), false, 'the stale snapshot itself is ignored');
    // Array.from(): built inside the vm context, so its prototype is that
    // realm's Array and deepEqual would reject it on structure alone.
    assert.deepEqual(Array.from(next.ctx.recentTabs), [7, 3],
        'the tab list is versioned separately, so it must still be applied');
});

test('a browser session with no snapshot starts cold instead of throwing', async () => {
    const w = loadWorker({});
    w.boot();
    await w.settle();

    assert.deepEqual({ ...w.ctx.openerJson }, {});
    assert.deepEqual({ ...w.ctx.urlIdJson }, {});
    assert.deepEqual(Array.from(w.ctx.recentTabs), []);
    assert.deepEqual(w.state.errors, [], 'a cold start must not log errors');
});

test('an oversized snapshot falls back to saving the part only it holds', async () => {
    // session.set() is atomic: one oversized key fails the whole write. Giving
    // up there would also lose the visit-id maps, which nothing can rebuild —
    // so the retry drops the two tab lists instead, the only part
    // initializeExistingTabs() can reconstruct from live tabs.
    const session = new Map();
    let attempts = 0;
    const w = loadWorker({
        sessionStore: session,
        sessionOverrides: {
            set(obj) {
                attempts++;
                if (attempts === 1) return Promise.reject(new Error('QUOTA_BYTES exceeded'));
                for (const [k, v] of Object.entries(obj)) session.set(k, v);
                return Promise.resolve();
            },
        },
    });
    w.boot();
    await w.settle();

    w.ctx.urlIdJson['https://parent/'] = 42;
    w.ctx.idUrlJson['42'] = 'https://parent/';
    w.ctx.openedTabs[5] = { id: 5, url: 'https://a/', title: 'A' };
    w.ctx.recentTabs = [5];

    await w.ctx.saveSessionState();

    assert.equal(attempts, 2, 'a rejected write must be retried, not abandoned');
    const saved = session.get('tab-state');
    assert.ok(saved, 'something has to survive: a cold start loses the visit tree');
    assert.equal(saved.urlIdJson['https://parent/'], 42);
    assert.equal(saved.idUrlJson['42'], 'https://parent/');
    assert.deepEqual({ ...saved.openedTabs }, {}, 'the tab lists are the part worth sacrificing');
    assert.deepEqual(Array.from(saved.recentTabs), []);
});

test('a session call that throws synchronously is caught rather than propagated', async () => {
    // `Promise.resolve(area.set(...))` evaluates set() *before* .catch() is
    // attached, so a synchronous throw escaped as an unhandled rejection.
    // Chrome throws this way when a value cannot be structured-cloned.
    const boom = () => { throw new Error('could not be cloned'); };
    const w = loadWorker({ sessionOverrides: { get: boom, set: boom, remove: boom } });
    w.boot();
    await w.settle();

    // None of these may reject: a rejected save would take down whatever
    // called it, which is the tab event handler or the startup chain.
    await w.ctx.saveSessionState();
    await w.ctx.saveCrawlCursor('id0', 0);
    await w.ctx.clearCrawlCursor();
    assert.equal(await w.ctx.restoreSessionState(), false);
    assert.equal(await w.ctx.restoreCrawlCursor(), 0);

    assert.ok(w.state.warnings.length >= 4,
        `every failure should be reported, saw: ${JSON.stringify(w.state.warnings)}`);
});

test('closing a tab drops everything keyed by its id', async () => {
    const w = loadWorker({});
    w.boot();
    await w.settle();

    w.ctx.openedTabs[5] = { id: 5, url: 'https://a/', title: 'A' };
    w.ctx.tabUrlJson['5'] = 'https://a/';
    w.ctx.tabUrl0Json['5'] = 'https://previous/';
    w.ctx.openerJson['5'] = 'https://opener/';
    w.ctx.recentTabs = [5, 6];

    w.ctx.closedTab(5);

    assert.deepEqual({ ...w.ctx.openedTabs }, {});
    assert.deepEqual({ ...w.ctx.tabUrlJson }, {});
    assert.deepEqual({ ...w.ctx.tabUrl0Json }, {});
    assert.deepEqual({ ...w.ctx.openerJson }, {});
    assert.deepEqual(Array.from(w.ctx.recentTabs), [6]);
});

test('a close record names the same session in its key and its group field', async () => {
    // The key used to be `<oid>_<tid>` while the grouping field was `oid - 1`,
    // so the record landed in a different session group than its own id said.
    // closed.js groups the tree by that field.
    const w = loadWorker({});
    w.boot();
    await w.settle();

    w.ctx.openedTabs[7] = { id: 7, url: 'https://a/', title: 'A' };
    w.ctx.closedTab(7);

    const record = w.state.closed[w.state.closed.length - 1];
    assert.equal(record.id, record.oid + '_' + record.tid);
    assert.equal(record.tid, 7);
    assert.equal(record.close, 0, 'a close from onRemoved is a normal close');
});

test('tabs closed while the worker is down are pruned on startup', async () => {
    const session = new Map();
    const stale = loadWorker({ sessionStore: session, tabs: [{ id: 1, active: true, url: 'https://a/', title: 'A' }] });
    stale.boot();
    await stale.settle();
    // Tab 9 closed while the worker was dead: onRemoved never reached us.
    stale.ctx.openedTabs[9] = { id: 9, url: 'https://gone/', title: 'Gone' };
    stale.ctx.tabUrlJson['9'] = 'https://gone/';
    stale.ctx.recentTabs = [9, 1];
    await stale.ctx.saveSessionState();

    const next = loadWorker({
        sessionStore: session,
        tabs: [{ id: 1, active: true, url: 'https://a/', title: 'A' }],
    });
    next.boot();
    await next.settle();

    assert.deepEqual(Object.keys(next.ctx.openedTabs).sort(), ['1']);
    assert.deepEqual({ ...next.ctx.tabUrlJson }, {});
    assert.deepEqual(Array.from(next.ctx.recentTabs), [1], 'a dead tab must not be shown as recently viewed');
});

test('the visit-id maps are capped and stay consistent with each other', async () => {
    const w = loadWorker({});
    w.boot();
    await w.settle();

    const total = SESSION_ID_LIMIT + 20;
    for (let i = 0; i < total; i++) {
        w.ctx.urlIdJson['https://x/' + i] = i;
        w.ctx.idUrlJson[String(i)] = 'https://x/' + i;
    }

    w.ctx.trimVisitIdMaps();

    assert.equal(Object.keys(w.ctx.urlIdJson).length, SESSION_ID_LIMIT);
    assert.equal(Object.keys(w.ctx.idUrlJson).length, SESSION_ID_LIMIT);
    // FIFO: the oldest URLs go, the newest stay.
    assert.equal(w.ctx.urlIdJson['https://x/0'], undefined);
    assert.equal(w.ctx.idUrlJson['0'], undefined);
    assert.equal(w.ctx.urlIdJson['https://x/' + (total - 1)], total - 1);
    assert.equal(w.ctx.idUrlJson[String(total - 1)], 'https://x/' + (total - 1));
});

test('add_tab_history() keeps the visit-id maps bounded as it records them', async () => {
    // The direct test above only proves trimVisitIdMaps() works; this one
    // proves the recording path calls it. Without the call the two maps grow
    // by one entry per visited URL for as long as the browser stays open.
    const w = loadWorker({});
    w.boot();
    await w.settle();

    const total = SESSION_ID_LIMIT + 20;
    for (let i = 1; i <= total; i++) {
        w.ctx.add_tab_history(
            [{ visitId: i, visitTime: Date.now(), referringVisitId: 0, transition: 'link' }],
            0,
            Date.now() - 1000,
            { id: 1, url: 'https://x/' + i, title: 'Page ' + i, lastVisitTime: Date.now() }
        );
    }

    assert.equal(Object.keys(w.ctx.urlIdJson).length, SESSION_ID_LIMIT);
    assert.equal(Object.keys(w.ctx.idUrlJson).length, SESSION_ID_LIMIT);
});

// ---------------------------------------------------------------------------
// The crawl
// ---------------------------------------------------------------------------

/** Point the worker at `urls` and run processVisits() against them. */
async function crawlUrls(opts) {
    const w = loadWorker(opts);
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = opts.urls;
    await w.ctx.processVisits();
    return w;
}

function urlList(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: 'id' + i,
        url: 'https://example.com/' + i,
        title: 'Page ' + i,
        lastVisitTime: Date.now(),
    }));
}

test('the crawl asks for several URLs at once instead of one at a time', async () => {
    const w = await crawlUrls({ urls: urlList(6) });

    assert.equal(w.state.queried.length, 6, 'every URL must be crawled');
    assert.ok(w.state.maxInFlight >= 2,
        `expected concurrent getVisits() calls, saw at most ${w.state.maxInFlight} in flight`);
    assert.ok(w.state.visits.length >= 6, 'visits must reach the database stub');
});

test('one failing URL does not abandon the rest of the crawl', async () => {
    const w = await crawlUrls({
        urls: urlList(3),
        getVisits: (state, q, cb) => {
            if (q.url === 'https://example.com/1') {
                throw new Error('history API exploded');
            }
            defaultGetVisits(state, q, cb);
        },
    });

    assert.deepEqual(w.state.queried, [
        'https://example.com/0',
        'https://example.com/1',
        'https://example.com/2',
    ]);
    assert.equal(w.state.visits.length, 2, 'the two healthy URLs must still be recorded');
    assert.ok(w.state.errors.some((e) => /getVisits\(\) error/.test(e)),
        'the failure should be logged rather than swallowed');
});

test('a persisted cursor resumes the crawl instead of restarting it', async () => {
    const session = new Map();
    // A previous worker got as far as id1 and was recycled.
    session.set('crawl-cursor', { id: 'id1', pos: 1, at: Date.now() });

    const w = await crawlUrls({ sessionStore: session, urls: urlList(4) });

    assert.deepEqual(w.state.queried, [
        'https://example.com/2',
        'https://example.com/3',
    ], 'URLs already crawled must not be fetched again');
    assert.equal(session.has('crawl-cursor'), false,
        'a finished crawl must clear the cursor, or the next one resumes past its own end');
});

test('a long crawl checkpoints its position before it finishes', async () => {
    // Without this the other crawl tests pass on 3-4 URLs, where no
    // checkpoint is ever due: the cursor would only ever be written by a
    // crawl that finished, which is the one case that does not need it.
    const session = new Map();
    const total = CRAWL_CHECKPOINT_URLS + 100;
    let cursorMidCrawl = null;

    const w = await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: (state, q, cb) => {
            if (q.url === 'https://example.com/' + (total - 1)) {
                cursorMidCrawl = session.get('crawl-cursor') || null;
            }
            defaultGetVisits(state, q, cb);
        },
    });

    assert.ok(cursorMidCrawl, 'a crawl longer than one checkpoint must leave a cursor behind');
    assert.ok(cursorMidCrawl.pos > 0 && cursorMidCrawl.pos < total,
        `cursor position ${cursorMidCrawl.pos} should sit inside the list of ${total}`);
    assert.equal(w.state.queried.length, total);
});

test('a stale cursor is ignored rather than trusted', async () => {
    const session = new Map();
    // Written six hours ago: new visits have changed the URL list since.
    session.set('crawl-cursor', { id: 'id1', pos: 1, at: Date.now() - 7 * 3600 * 1000 });

    const w = await crawlUrls({ sessionStore: session, urls: urlList(4) });

    assert.equal(w.state.queried.length, 4, 'an expired cursor must not skip anything');
});

// ---------------------------------------------------------------------------
// The extension's own pages
//
// Opening the popup navigates a tab, which fires tabs.onUpdated. That used to
// reach visitTab(): a getVisits() round trip per popup open, a "history" row for
// the extension's own UI, and — because it is an event — a worker wake-up whose
// side effect is the whole startup crawl running again.
// ---------------------------------------------------------------------------

test('a tab navigating to the extension\'s own page is not crawled', async () => {
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    const own = 'chrome-extension://test-extension-id/popup.html';
    w.fire('tabs.onUpdated', 1, { status: 'complete' }, { id: 1, url: own, title: 'Popup | Recent History' });
    await w.settle();

    assert.deepEqual(w.state.queried, [], [
        'our own URL must not reach chrome.history.getVisits(): opening the popup',
        'would otherwise wake the worker and re-run the startup crawl.',
    ].join(' '));
    assert.deepEqual(w.state.visits, [], 'and must not be filed as a visited page');
});

test('a tab navigating to a real page is still crawled', async () => {
    // The guard above must not swallow ordinary browsing.
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    w.fire('tabs.onUpdated', 1, { status: 'complete' },
        { id: 1, url: 'https://example.com/page', title: 'A real page' });
    await w.settle();

    assert.deepEqual(w.state.queried, ['https://example.com/page']);
});

// ---------------------------------------------------------------------------
// Heat map back-fill
//
// The crawl is the only writer for days older than today. It records each visit
// it walks into `calendar_storage2` — but only where the map is empty, because
// those days cannot change: re-reading them on every start is pure cost.
// ---------------------------------------------------------------------------

/** The map's key for the day `t` falls on (the day's own end). */
function dayKeyOf(t) {
    const d = new Date(t);
    d.setHours(23);
    d.setMinutes(59);
    d.setSeconds(59);
    d.setMilliseconds(999);
    return d.getTime();
}

const DAY_MS = 86400000;

/** A visit `daysAgo` days back. */
function visitAt(daysAgo, id) {
    return { visitId: id, visitTime: dayKeyOf(Date.now() - daysAgo * DAY_MS) - 3600000, referringVisitId: 0, transition: 'link' };
}

/** `getVisits` that reports `visits` for every URL. */
function visitsFor(visits) {
    return (state, q, cb) => setTimeout(() => { state.visitCounter += visits.length; cb(visits); }, 0);
}

test('the crawl fills the heat map for the days it walked', async () => {
    // `load-range` is 7 in crawlUrls(): only visits inside that window reach
    // the map, because only those are crawled. Days beyond it stay empty until
    // the window moves over them — the map grows backwards one day per day,
    // which is the trade the option already documents.
    const w = await crawlUrls({
        urls: urlList(2),
        getVisits: visitsFor([visitAt(3, 1), visitAt(3, 2), visitAt(6, 3), visitAt(30, 4)]),
    });

    assert.equal(w.ctx.calendar_storage2[dayKeyOf(Date.now() - 3 * DAY_MS)], 4,
        'two visits per URL, two URLs, all three days back');
    assert.equal(w.ctx.calendar_storage2[dayKeyOf(Date.now() - 6 * DAY_MS)], 2,
        'the last full day inside the window is filled too');
    assert.equal(w.ctx.calendar_storage2[dayKeyOf(Date.now() - 30 * DAY_MS)], undefined,
        'a visit the crawl never walks cannot reach the map');
});

test('a day that already has a count is not re-read (the map is a cache)', async () => {
    // The whole point of the change: yesterday's square is a cache, not a
    // snapshot. Recomputing it on every start is what the crawl exists to stop
    // paying for.
    //
    // Only days within `load-range` are crawled at all (the crawl walks recent
    // URLs), which is exactly the window this test is about: a day the crawl
    // *does* revisit must still keep the count it already had.
    const key = dayKeyOf(Date.now() - 3 * DAY_MS);
    const w = loadWorker({ getVisits: visitsFor([visitAt(3, 1), visitAt(3, 2)]) });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.localStorage['calendar-storage2'] = JSON.stringify({ [key]: 99 });
    w.boot();
    await w.settle();
    assert.equal(w.ctx.calendar_storage2[key], 99, 'boot() must hydrate the map from storage');

    w.ctx.urls_wait_load = urlList(1);
    await w.ctx.processVisits();

    assert.equal(w.ctx.calendar_storage2[key], 99,
        'four visits were just walked into a day that already said 99, and it must keep saying 99');
});

test('the crawl is what creates the map, and a back-filled day stays put', async () => {
    // Same worker twice: the second crawl re-walks the same visits and must be
    // a no-op for the map. A guard that only checked "is the map empty" would
    // pass the first crawl and then either rewrite or duplicate on the second.
    const w = await crawlUrls({
        urls: urlList(1),
        getVisits: visitsFor([visitAt(4, 1)]),
    });
    const key = dayKeyOf(Date.now() - 4 * DAY_MS);
    assert.equal(w.ctx.calendar_storage2[key], 1);

    w.ctx.calendar_storage2[key] = 7; // pretend a later crawl saw more
    w.ctx.urls_wait_load = urlList(1);
    await w.ctx.processVisits();
    assert.equal(w.ctx.calendar_storage2[key], 7, 'the existing count must win');
});

test('browser-internal visits do not count towards a day', async () => {
    // Same rule add_urls() uses to decide what enters the database, so the
    // square counts what the tree can actually show.
    const w = await crawlUrls({
        urls: [{ id: 'id0', url: 'chrome://extensions/', title: 'Extensions', lastVisitTime: Date.now() }],
        getVisits: visitsFor([visitAt(5, 1)]),
    });

    assert.equal(w.ctx.calendar_storage2[dayKeyOf(Date.now() - 5 * DAY_MS)], undefined,
        'a chrome:// page is not browsing');
});

test('the heat map is persisted, not just kept in memory', async () => {
    const w = await crawlUrls({
        urls: urlList(1),
        getVisits: visitsFor([visitAt(5, 1)]),
    });

    const stored = JSON.parse(w.ctx.localStorage['calendar-storage2']);
    assert.equal(stored[dayKeyOf(Date.now() - 5 * DAY_MS)], 1,
        'the map has to reach storage or the next worker start re-crawls for nothing');
});

test('real pages are counted and internal ones are not', async () => {
    // The square is a summary of what the tree below it can show, so it uses
    // the rule that decides what enters the tree at all (add_urls()'s regex
    // pair on `(title, url)`). Note the two rules are *not* interchangeable
    // and must not be merged: the crawl skips a page when its URL is internal,
    // add_urls() also skips one whose title is — which is why `urls_wait_load`
    // still contains pages that never reach the database.
    const day = dayKeyOf(Date.now() - 4 * DAY_MS);

    const w = await crawlUrls({
        urls: [{ id: 'id0', url: 'https://example.com/', title: 'Example', lastVisitTime: Date.now() }],
        getVisits: visitsFor([visitAt(4, 1), visitAt(4, 2)]),
    });
    assert.equal(w.ctx.calendar_storage2[day], 2, 'both visits on a browsable page count');

    const internal = await crawlUrls({
        urls: [{ id: 'id0', url: 'chrome://extensions/', title: 'Extensions', lastVisitTime: Date.now() }],
        getVisits: visitsFor([visitAt(4, 1)]),
    });
    assert.equal(internal.ctx.calendar_storage2[day], undefined, 'a chrome:// page is not browsing');
});

test('the crawl never writes today, even into an empty map', async () => {
    // Today belongs to the page. The crawl runs *before* the page ever does on
    // a fresh profile (or after history was cleared, i.e. an empty map) and it
    // only sees the visits that existed when it ran — so a count taken here
    // would be a stale one, and being non-zero it would then hide today from
    // the crawl forever, outliving the page's fresher count.
    //
    // The day to assert on is `Date.now()`, deliberately *not* `dayKeyOf(now)`
    // used as a visit time: `dayKeyOf` pins the event to 23:59:59.999 of its
    // day, so in the last millisecond of a day (or on any clock skew) the key
    // would answer for tomorrow and this test would go green while the bug
    // lived on. `Date.now()` is unambiguously in the day the worker calls
    // today.
    const w = loadWorker({
        getVisits: visitsFor([{ visitId: 1, visitTime: Date.now(), referringVisitId: 0, transition: 'link' }]),
    });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = urlList(1);

    await w.ctx.processVisits();

    assert.equal(w.ctx.calendar_storage2[dayKeyOf(Date.now())], undefined,
        'the crawl counted a visit for today and wrote it; today is the page\'s to write');
});

test('a crawl started before today was re-counted does not undo it', async () => {
    // The same boundary from the other side: the page has already written
    // today, the worker boots (hydrating the map) and crawls. It must leave the
    // page's count exactly as it is — it may only fill a day that has none, and
    // today is not one of those.
    const key = dayKeyOf(Date.now());
    const w = loadWorker({ getVisits: visitsFor([{ visitId: 1, visitTime: Date.now(), referringVisitId: 0, transition: 'link' }]) });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.localStorage['calendar-storage2'] = JSON.stringify({ [key]: 42 });
    w.boot();
    await w.settle();
    assert.equal(w.ctx.calendar_storage2[key], 42, 'boot() must hydrate the map from storage');

    w.ctx.urls_wait_load = urlList(1);
    await w.ctx.processVisits();

    assert.equal(w.ctx.calendar_storage2[key], 42,
        'the crawl saw one visit for today and must leave the page\'s fresh count alone');
});

// ---------------------------------------------------------------------------
// The most-visited cache
//
// mv-cache is the one thing the worker writes that the popup renders verbatim,
// so whatever lands in it has already decided how the title will look. This is
// the mostVisitedInit() half of that contract: it must store the title the
// browser reported, not a pre-escaped version of it.
// ---------------------------------------------------------------------------

test('the most-visited cache stores titles raw', async () => {
    // `mv-cache` used to be written with `title.replace(/"/g, '&#34;')`, and
    // mostVisited() hands the value straight to formatItem(), which escapes it
    // again — so a page titled `say "hi"` reached the cache as
    // `say &#34;hi&#34;` and rendered as the literal text `say &amp;#34;hi&amp;#34;`.
    // Escaping belongs to the renderer, which is the only side that knows it is
    // writing text content.
    const w = loadWorker({
        historyResults: [{
            url: 'https://example.com/quotes',
            title: 'say "hi" & <b>bye</b>',
            lastVisitTime: Date.now(),
            visitCount: 7,
        }],
    });
    w.boot();
    await w.settle();

    const cache = JSON.parse(w.ctx.localStorage['mv-cache']);
    assert.equal(cache.length, 1);
    assert.equal(cache[0].title, 'say "hi" & <b>bye</b>',
        'the cache must hold the title verbatim; escaping it here double-escapes it at render time');
});

test('the most-visited cache drops nothing a later read would need', async () => {
    // The pair it rides along with: an empty title falls back to the URL, which
    // is what the popup has always shown for untitled pages. Also covers the
    // browser-internal rows it skips, so "one row survived" means "the right
    // row survived".
    const w = loadWorker({
        historyResults: [
            { url: 'https://example.com/untitled', title: '', lastVisitTime: Date.now(), visitCount: 3 },
            { url: 'https://example.com/named', title: 'Named', lastVisitTime: Date.now(), visitCount: 2 },
            { url: 'chrome://extensions', title: 'Extensions', lastVisitTime: Date.now(), visitCount: 99 },
        ],
    });
    w.boot();
    await w.settle();

    const cache = JSON.parse(w.ctx.localStorage['mv-cache']);
    assert.deepEqual(cache.map((c) => c.url),
        ['https://example.com/untitled', 'https://example.com/named']);
    assert.equal(cache[0].title, 'https://example.com/untitled', 'an empty title falls back to the URL');
    assert.equal(cache[1].visitCount, 2);
});

// ---------------------------------------------------------------------------
// Favicon negative cache
//
// It lives in `chrome.storage.local` as one JSON string, so every read is a
// full `JSON.parse()` and every write a full `JSON.stringify()` — and one
// popup open adds an entry per row whose icon failed. Left unbounded it grew
// for as long as the favicon service stayed unreachable: measured 20k entries
// is 1.3MB, ~12ms to read and ~51ms to write, i.e. seconds of service-worker
// CPU per popup on the worker that is also answering those requests.
// ---------------------------------------------------------------------------

// Read back out of the source: hard-coding it here would let the two drift.
const NEGATIVE_CACHE_MAX = Number(/const NEGATIVE_CACHE_MAX = (\d+)/.exec(SW_SRC)[1]);
const NEGATIVE_CACHE_TTL = Number(/const NEGATIVE_CACHE_TTL = (\d+)/.exec(SW_SRC)[1]);
const NEGATIVE_CACHE_FLUSH_MS = Number(/const NEGATIVE_CACHE_FLUSH_MS = (\d+)/.exec(SW_SRC)[1]);

/** The cache as the worker left it in storage. */
function negCache(w) {
    return JSON.parse(w.ctx.localStorage['favicon-negative-cache'] || '{}');
}

/**
 * Failures are held for a tick and written back as one batch, so a test has
 * to end the batch before it can look at storage.
 */
function addNeg(w, url) {
    w.ctx.addNegativeCache(url);
    w.ctx.flushNegativeCache();
}

test('the negative cache stops growing instead of filling chrome.storage.local', async () => {
    const w = loadWorker();
    w.boot();
    await w.settle();

    const n = NEGATIVE_CACHE_MAX + 200;
    for (let i = 0; i < n; i++) {
        addNeg(w, 'https://icons.duckduckgo.com/ip3/host' + i + '.test.ico');
    }

    const size = Object.keys(negCache(w)).length;
    assert.ok(size <= NEGATIVE_CACHE_MAX,
        `${n} failures left ${size} entries, expected at most ${NEGATIVE_CACHE_MAX}`);
});

test('the negative cache evicts its oldest entries, not arbitrary ones', async () => {
    // `Object.keys()` walks insertion order, so the survivors must be the most
    // recently failed URLs — the ones still likely to fail.
    const w = loadWorker();
    w.boot();
    await w.settle();

    const n = NEGATIVE_CACHE_MAX + 200;
    for (let i = 0; i < n; i++) {
        addNeg(w, 'https://icons.duckduckgo.com/ip3/host' + i + '.test.ico');
    }
    const keys = Object.keys(negCache(w));
    assert.equal(keys.length, NEGATIVE_CACHE_MAX, 'the cache holds exactly the cap');
    assert.ok(!keys.includes('https://icons.duckduckgo.com/ip3/host0.test.ico'),
        'the oldest entry must be the first to go');
    assert.ok(!keys.includes('https://icons.duckduckgo.com/ip3/host199.test.ico'),
        'the 200 oldest entries must all be gone');
    assert.ok(keys.includes('https://icons.duckduckgo.com/ip3/host' + (n - 1) + '.test.ico'),
        'the newest entry must survive');
});

test('a popup\'s worth of failures is one write, not one per icon', async () => {
    // The cap stops the cache growing; it does not stop every add costing a
    // full read-modify-write of the whole thing, because once the cache sits
    // at the cap every add still parses and re-serialises 2000 entries.
    // Measured 5000 adds at ~0.9ms each, i.e. ~15ms of worker CPU for a
    // 16-row popup whose icons all failed.
    const w = loadWorker();
    w.boot();
    await w.settle();

    const rows = 16;
    for (let i = 0; i < rows; i++) {
        w.ctx.addNegativeCache('https://icons.duckduckgo.com/ip3/batch' + i + '.test.ico');
    }
    w.ctx.flushNegativeCache();

    assert.equal(w.state.negWrites, 1,
        `${rows} failures cost ${w.state.negWrites} cache writes; they are one batch`);
    assert.equal(Object.keys(negCache(w)).length, rows, 'the batch must reach storage in full');
});

test('a failure is remembered before the batch that carries it is written', async () => {
    // Batching delays the write, and `handleFaviconRequest()` asks about the
    // fallback URL immediately after failing the primary one — inside the
    // same tick. A batch that only counted once it landed in storage would
    // fetch the fallback it just recorded as broken.
    const w = loadWorker();
    w.boot();
    await w.settle();

    const url = 'https://icons.duckduckgo.com/ip3/inflight.test.ico';
    w.ctx.addNegativeCache(url);
    assert.equal(w.ctx.isNegativeCached(url), true,
        'a pending failure must suppress its own URL before the flush');
});

test('the batch is written by its timer, not only by hand', async () => {
    const w = loadWorker();
    w.boot();
    await w.settle();

    w.ctx.addNegativeCache('https://icons.duckduckgo.com/ip3/timed.test.ico');
    assert.equal(w.state.negWrites, 0, 'nothing is written inside the add itself');

    await new Promise((r) => setTimeout(r, NEGATIVE_CACHE_FLUSH_MS + 20));
    assert.equal(w.state.negWrites, 1, 'the timer must flush the batch on its own');
});

test('a negative-cached URL is skipped, and one past its TTL is retried', async () => {
    const w = loadWorker();
    w.boot();
    await w.settle();

    const url = 'https://icons.duckduckgo.com/ip3/once.test.ico';
    addNeg(w, url);
    assert.equal(w.ctx.isNegativeCached(url), true, 'a fresh failure must be remembered');

    // Age it out: the entry is a timestamp, so rewriting it is enough.
    const cache = negCache(w);
    cache[url] = Date.now() - NEGATIVE_CACHE_TTL - 1;
    w.ctx.setNegativeCache(cache);
    assert.equal(w.ctx.isNegativeCached(url), false, 'an expired entry must allow a retry');
});

test('expired entries are swept on the periodic alarm, not on every write', async () => {
    const w = loadWorker();
    w.boot();
    await w.settle();

    const stale = 'https://icons.duckduckgo.com/ip3/stale.test.ico';
    const fresh = 'https://icons.duckduckgo.com/ip3/fresh.test.ico';
    const cache = { [stale]: Date.now() - NEGATIVE_CACHE_TTL - 1, [fresh]: Date.now() };
    w.ctx.setNegativeCache(cache);

    // Adding to the cache must not sweep it — that is a second O(size) pass
    // on top of a write that is already O(size), and the cap already bounds
    // what the sweep would reclaim.
    addNeg(w, 'https://icons.duckduckgo.com/ip3/added.test.ico');
    assert.ok(stale in negCache(w), 'an add must not pay for a sweep');

    w.fire('alarms.onAlarm', { name: 'mostVisited' });
    assert.ok(!(stale in negCache(w)), 'the alarm must drop entries past their TTL');
    assert.ok(fresh in negCache(w), 'entries inside their TTL must survive');
});

test('the parsed negative cache is dropped when another context clears it', async () => {
    // The options page's "clear icon cache" calls
    // `localStorage.removeItem()`, which does not go through
    // `setNegativeCache()`. Without invalidation the worker keeps its parsed
    // copy and goes on suppressing URLs the user just unblocked.
    const w = loadWorker();
    w.boot();
    await w.settle();

    const url = 'https://icons.duckduckgo.com/ip3/cleared.test.ico';
    addNeg(w, url);
    assert.equal(w.ctx.isNegativeCached(url), true);

    delete w.ctx.localStorage['favicon-negative-cache'];
    // What storage-adapter.js delivers for a removal from another context.
    w.fire('storage.onChanged', { 'favicon-negative-cache': {} }, 'local');
    assert.equal(w.ctx.isNegativeCached(url), false, 'clearing the cache must take effect immediately');
});

test('the worker\'s own writes do not invalidate the copy it just made', async () => {
    // The other writer is this worker, and `setNegativeCache()` reaches the
    // same `onChanged` listener — as a change *with* a `newValue`. Taking
    // every change as foreign discards the parsed copy on every add, so the
    // next lookup re-parses the cache the copy was there to avoid: measured
    // re-parse on every add, which is the cost the copy removes.
    const w = loadWorker();
    w.boot();
    await w.settle();

    const url = 'https://icons.duckduckgo.com/ip3/own.test.ico';
    addNeg(w, url);

    // What storage-adapter.js delivers for a write from anywhere, including
    // from here: the change carries the new value.
    w.fire('storage.onChanged',
        { 'favicon-negative-cache': { newValue: w.ctx.localStorage['favicon-negative-cache'] } },
        'local');

    const before = w.state.jsonParses;
    assert.equal(w.ctx.isNegativeCached(url), true, 'the entry must still be there');
    assert.equal(w.state.jsonParses, before,
        'a write of its own must not force the worker to re-parse the cache');
});
