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
// Read out of the source, like the two above: the budget is the thing that
// bounds a pass, so a test that hard-codes it would pass whatever it says.
const CRAWL_BUDGET_URLS = Number(/const CRAWL_BUDGET_URLS = (\d+)/.exec(SW_SRC)[1]);
const CRAWL_STATE_KEY = /const CRAWL_STATE_KEY = '([^']+)'/.exec(SW_SRC)[1];
const CRAWL_STATE_VERSION = Number(/const CRAWL_STATE_VERSION = (\d+)/.exec(SW_SRC)[1]);
const CRAWL_SWEEP_TTL = eval(/const CRAWL_SWEEP_TTL = ([^;]+);/.exec(SW_SRC)[1]);
const CRAWL_CURSOR_TTL = eval(/const CRAWL_CURSOR_TTL = ([^;]+);/.exec(SW_SRC)[1]);

/** The one crawl-state object as stored, or undefined. */
function stateAt(session) {
    return session.get(CRAWL_STATE_KEY);
}

/** Seed a complete, versioned crawl-state object (any field may be omitted). */
function seedState(session, fields = {}) {
    session.set(CRAWL_STATE_KEY, Object.assign({
        v: CRAWL_STATE_VERSION,
        cursor: null,
        heat: {},
        sweepAt: 0,
    }, fields));
}
const CRAWL_PERIOD_MINUTES = Number(/const CRAWL_PERIOD_MINUTES = ([\d.]+)/.exec(SW_SRC)[1]);

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
 * @param {Function} [opts.Date] a Date constructor with a fixed now(), for
 *   tests that assert a whole-day boundary rather than a relative span.
 */
function loadWorker(opts = {}) {
    const sessionStore = opts.sessionStore || new Map();
    const events = new Map();
    const readyCallbacks = [];
    let storageReady = false;

    const state = {
        tabs: opts.tabs || [],
        visits: [],
        urls: [],
        closed: [],
        badges: [],
        // Shared between workers when a case needs the alarm to outlive one:
        // the alarm lives in the browser, not in the worker, and a fresh array
        // per worker is how the "don't re-arm an existing alarm" case used to
        // pass without proving anything.
        alarms: opts.alarmStore || [],
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
        // URLs written to the favicon Cache API by the injected caches.open()
        // recorder below. Empty for the crawl/session cases that never touch
        // the cache, so a stray write is visible rather than silently allowed.
        cachePuts: opts.faviconCachePuts || [],
        purgedAt: [],
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
        alarms: {
            // Recorded rather than ignored: the crawl is paced by an alarm now,
            // and two cases below answer questions about how it is armed.
            create: (name, info) => { state.alarms.push({ name, info }); },
            get: (name, cb) => cb(state.alarms.find((a) => a.name === name) || null),
            clear: () => {},
            onAlarm: ev('alarms.onAlarm'),
        },
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
        // The window's URL list. Default is empty: most cases drive the crawl
        // through `urls_wait_load` and only a few need `loadHistory()` to build
        // its own queue.
        queryURLs: opts.queryURLs || (() => Promise.resolve([])),
        // Records the cutoff the worker decided on; the stores themselves are
        // not simulated here (db-manager.test.mjs covers the real sweep).
        purgeExpired: (cutoff) => { state.purgedAt.push(cutoff); return Promise.resolve(0); },
        deleteDB: () => Promise.resolve(),
    };

    // Injectable clock for the retention boundary test: dayKey() buckets a
    // whole day into one 23:59:59.999 key, so a case that asserts which day
    // survives needs a `now` that cannot drift across midnight mid-test.
    const Clock = opts.Date || Date;
    const ctx = {
        chrome,
        dbManager,
        Date: Clock,
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
        // Web-platform globals the real Service Worker has. Injected for the
        // favicon tests, which drive handleFaviconRequest()/fallback end to end
        // and need to see exactly which keys were written to the shared cache.
        URL,
        Request: function (url) { this.url = String(url); },
        fetch: opts.faviconFetch || (async () => { throw new Error('fetch is not stubbed in this worker'); }),
        // match() always misses so the network path is exercised; put() records
        // the URL so a test can tell an exact-URL write from a shared-`<host>`
        // one. The default recorder is state.cachePuts.
        caches: {
            open: async () => ({
                match: async () => undefined,
                put: async (req, res) => {
                    state.cachePuts.push(req.url);
                    return res;
                },
            }),
            delete: async () => true,
        },
        Response: { error: () => ({}) },
        // The worker's own onStorageReady hook. Nothing runs until boot(), and
        // afterwards it fires straight away — which is what the real adapter
        // does, and the only reason an alarm arriving later can start a pass.
        onStorageReady: (cb) => {
            if (storageReady) cb();
            else readyCallbacks.push(cb);
        },
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
        boot() {
            storageReady = true;
            for (const cb of readyCallbacks.splice(0)) cb();
        },
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
                // Only the tab-state snapshot is oversized. The crawl writes
                // its own single state key during boot; rejecting every set()
                // would let that unrelated write consume the one failure this
                // case means to inject.
                if (Object.prototype.hasOwnProperty.call(obj, 'tab-state')) {
                    attempts++;
                    if (attempts === 1) return Promise.reject(new Error('QUOTA_BYTES exceeded'));
                }
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
    await w.ctx.saveCrawlState(w.ctx.emptyCrawlState());
    assert.equal(await w.ctx.restoreSessionState(), false);
    assert.equal((await w.ctx.restoreCrawlState()).cursor, null,
        'a storage failure must degrade to a fresh window, not propagate');

    assert.ok(w.state.warnings.length >= 1,
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

/**
 * Point the worker at `urls` and run one pass of the crawl against them.
 *
 * @param {object} opts
 * @param {Array}  opts.urls the window's URL list.
 * @param {object} [opts.state] fields to plant in the one `crawl-state`
 *   object before the pass runs (cursor / heat / sweepAt). The sweep watermark
 *   used to be a separate key handed to processVisits() as an argument; it is
 *   now part of this object, which the pass reads in one get().
 */
async function crawlUrls(opts) {
    const w = loadWorker(opts);
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = opts.urls;
    if (opts.state) seedState(w.sessionStore, opts.state);
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
    // A previous worker got as far as id1 and was recycled. The cursor and
    // the counts it had gathered are two fields of ONE object now.
    seedState(session, { cursor: { id: 'id1', pos: 1, at: Date.now() } });

    const w = await crawlUrls({ sessionStore: session, urls: urlList(4) });

    assert.deepEqual(w.state.queried, [
        'https://example.com/2',
        'https://example.com/3',
    ], 'URLs already crawled must not be fetched again');
    assert.equal(stateAt(session).cursor, null,
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
                cursorMidCrawl = (stateAt(session) || {}).cursor || null;
            }
            defaultGetVisits(state, q, cb);
        },
    });

    assert.ok(cursorMidCrawl, 'a crawl longer than one checkpoint must leave a cursor behind');
    assert.ok(cursorMidCrawl.pos > 0 && cursorMidCrawl.pos < total,
        `cursor position ${cursorMidCrawl.pos} should sit inside the list of ${total}`);
    assert.equal(w.state.queried.length, total);
});

// ---------------------------------------------------------------------------
// Pacing
//
// The crawl used to be one job per worker start: walk the whole window,
// however long that takes. It is bounded now, so the window can be swept in
// several short passes — which is what makes running it more often affordable.
// ---------------------------------------------------------------------------

test('a pass stops at its budget and leaves a cursor behind', async () => {
    // The change itself. A window larger than one pass has to be coverable by
    // several of them, and the only thing standing between "several" and
    // "always the first 300" is the cursor written on the way out.
    const session = new Map();
    const total = CRAWL_BUDGET_URLS + 50;
    const w = await crawlUrls({ sessionStore: session, urls: urlList(total) });

    assert.equal(w.state.queried.length, CRAWL_BUDGET_URLS,
        `a pass must not walk more than its budget (${CRAWL_BUDGET_URLS})`);
    const saved = stateAt(session);
    assert.ok(saved, 'an unfinished window must leave a state object behind');
    // Exactly ONE key in session storage describes the crawl: cursor, counts
    // and sweep are fields of it, not three independent keys.
    assert.deepEqual([...session.keys()].filter((k) => k.startsWith('crawl-')), [CRAWL_STATE_KEY],
        'the crawl must persist to one key, not a cursor/heat/sweep trio');
    const cursor = saved.cursor;
    assert.ok(cursor, 'an unfinished window must leave a position to resume from');
    // "How many of the list were walked", which is what the id path returns and
    // what the position has to agree with — off by one here and a resume that
    // falls back to it re-walks a URL, which the heat accumulator then counts
    // twice.
    assert.equal(cursor.pos, CRAWL_BUDGET_URLS,
        'the stored position is the count walked, not the index of the last URL');

    // The point of the cursor: the next pass picks up there instead of
    // re-walking the head of the list.
    const next = await crawlUrls({ sessionStore: session, urls: urlList(total) });
    assert.equal(next.state.queried.length, total - CRAWL_BUDGET_URLS,
        'the second pass must start where the first stopped');
    assert.ok(stateAt(session).sweepAt > 0,
        'and together they must finish the window, which records the sweep watermark');
});

test('a window walked in several passes is counted as a whole', async () => {
    // The reason the accumulator exists. A day's square is filled once and then
    // left alone (the map is a cache), so whichever pass writes it first decides
    // the number for good. Writing a pass's own share would therefore record the
    // head of the window and never the tail: 350 URLs, one visit each, must read
    // 350 — not 300, and not 50.
    const session = new Map();
    const total = CRAWL_BUDGET_URLS + 50;
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);

    const first = await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: visitsFor([visitAt(3, 1)]),
    });
    assert.equal(first.ctx.calendar_storage2[day], undefined,
        'half a window must not be published as the day\'s count');

    const second = await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: visitsFor([visitAt(3, 2)]),
    });
    assert.equal(second.state.queried.length, total - CRAWL_BUDGET_URLS,
        'the second pass must walk only the tail');
    assert.equal(second.ctx.calendar_storage2[day], total,
        'the finished window must publish every visit the passes walked');
});

test('the counted head of a window survives a worker restart', async () => {
    // The passes of one window routinely land in different workers, and the
    // counts of the ones that already ran exist only in the accumulator. Losing
    // them to a recycle is the same bug as never accumulating: the tail's pass
    // would publish its own share over the whole window's day.
    const session = new Map();
    const total = CRAWL_BUDGET_URLS + 50;
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);

    await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: visitsFor([visitAt(3, 1)]),
    });
    assert.ok(Object.keys(stateAt(session).heat).length > 0,
        'the counts must reach the one stored state object, not just the worker');

    // A fresh worker: nothing of the first pass is in scope except session
    // storage, which is exactly what a recycle leaves behind.
    const second = await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: visitsFor([visitAt(3, 2)]),
    });
    assert.equal(second.ctx.calendar_storage2[day], total,
        'the tail of the window must be added to what the head already counted');
    assert.deepEqual({ ...stateAt(session).heat }, {},
        'a finished window must not leave its accumulator behind for the next one');
});

test('a resume with an empty queue still publishes what was counted', async () => {
    // The window shrank to nothing between two passes — a retention sweep
    // deleted the visits, or the user cleared history. The cursor's id is gone
    // with them, so the position is 0 again; the counts of the passes that did
    // run are still owed to the map, and the window is finished rather than
    // merely idle. Returning early on "walked nothing" would park them.
    const session = new Map();
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    seedState(session, {
        cursor: { id: 'gone', pos: 999, at: Date.now() },
        heat: { [day]: CRAWL_BUDGET_URLS },
    });

    const w = loadWorker({ sessionStore: session });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = [];

    await w.ctx.processVisits();

    assert.equal(w.state.queried.length, 0, 'there is nothing left to walk');
    assert.equal(w.ctx.calendar_storage2[day], CRAWL_BUDGET_URLS,
        'the counts of the passes that did run must still reach the map');
    assert.deepEqual({ ...stateAt(session).heat }, {}, 'and the accumulator is done with');
});

test('an id that has left the queue resumes from the top, ignoring the stored position', async () => {
    // The cursor id is the only anchor. When it is gone — those URLs were
    // walked, stamped with loadto, and filtered out of the rebuilt list — the
    // pass starts from the top of what is left and keeps the counts already
    // gathered. The old code fell back to `pos` here, which was an index into
    // the *previous* list: on a list that had shrunk but was still long enough
    // to hold `pos`, that skipped the untouched middle of the window, judged it
    // finished, and published a partial count to a cache nobody recomputes.
    const session = new Map();
    const total = 6;
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    seedState(session, {
        cursor: { id: 'gone', pos: 3, at: Date.now() },
        heat: { [day]: 2 },
    });

    const w = await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: visitsFor([visitAt(3, 1)]),
    });

    assert.deepEqual(w.state.queried, urlList(total).map((u) => u.url),
        'a stale `pos` must not skip the head of the rebuilt list');
    assert.equal(w.ctx.calendar_storage2[day], 2 + total,
        'the resumed window keeps the earlier counts and adds the whole tail');
});

test('a window counted in passes survives the URLs leaving the queue', async () => {
    // The shape `loadHistory()` really produces, which every other crawl case
    // here sidesteps by handing `urls_wait_load` in directly and keeping it
    // whole across passes.
    //
    // `crawlUrlVisits()` stamps `loadto` with each URL's newest visit, and
    // `loadHistory()` drops every URL whose `loadto` is not older than
    // `lastVisitTime` — which after a crawl is every URL it just walked. So a
    // crawled URL is gone from the next pass's list: the cursor's id is no
    // longer there, and its position is past the end of what is left. Both
    // halves of resumeIndex() therefore fail, it returns 0, and 0 is
    // also what it returns when there is nothing to resume — so the pass reads
    // it as "a brand new window" and throws the first pass's 300 counts away as
    // stale. The pass that finishes the window then publishes its own 50.
    const session = new Map();
    const total = CRAWL_BUDGET_URLS + 50;
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    const visit = visitAt(3, 1);
    // `lastVisitTime` is the newest visit, as the database would have it: that
    // is what makes a walked URL's `loadto` equal to it rather than older.
    const urls = urlList(total).map((u) => Object.assign({}, u, { lastVisitTime: visit.visitTime }));

    // The URL store as the crawl leaves it: a written URL comes back stamped,
    // and the filter below is loadHistory()'s own.
    const w = loadWorker({
        sessionStore: session,
        getVisits: visitsFor([visit]),
        queryURLs: () => Promise.resolve(urls
            .map((u) => {
                const stored = w.state.urls.find((r) => r.id === u.id);
                return Object.assign({}, u, { loadto: stored && stored.loadto });
            })
            .filter((u) => !u.loadto || u.loadto < u.lastVisitTime)),
    });
    w.ctx.localStorage['load-range'] = '7';

    await w.ctx.loadHistory();
    assert.equal(w.state.queried.length, CRAWL_BUDGET_URLS, 'the first pass spends its budget');
    assert.ok(Object.keys(stateAt(session).heat).length > 0, 'and leaves its counts behind');

    // Second pass: the list it rebuilds no longer holds the URLs the first one
    // walked, so the cursor points at nothing.
    w.ctx.urls_wait_load = [];
    await w.ctx.loadHistory();

    assert.equal(w.state.queried.length, total, 'both passes together must walk the window');
    assert.equal(w.ctx.calendar_storage2[day], total,
        'the pass that finishes the window must publish the whole of it, not its own tail');
});

test('a shrinking queue longer than the old position still counts the whole window', async () => {
    // The shape that used to lose a whole budget-sized segment. The window is
    // more than two passes wide, so after the first pass stamps 300 URLs the
    // rebuilt list is still longer than the stored position (300): the old
    // `pos` fallback looked valid, resumed at 300 in a list that had dropped
    // its own head, and skipped URLs 300..599 — none of which had been walked.
    // That pass was then judged complete and wrote a short count into a heat
    // map that never recomputes a day. Driven through loadHistory() end to end
    // so the stamping, the filter and the rebuild are all the real ones.
    const session = new Map();
    const total = 2 * CRAWL_BUDGET_URLS + 50;
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    const visit = visitAt(3, 1);
    const urls = urlList(total).map((u) => Object.assign({}, u, { lastVisitTime: visit.visitTime }));

    const w = loadWorker({
        sessionStore: session,
        getVisits: visitsFor([visit]),
        queryURLs: () => Promise.resolve(urls
            .map((u) => {
                const stored = w.state.urls.find((r) => r.id === u.id);
                return Object.assign({}, u, { loadto: stored && stored.loadto });
            })
            .filter((u) => !u.loadto || u.loadto < u.lastVisitTime)),
    });
    w.ctx.localStorage['load-range'] = '7';

    // Three passes: 300 + 300 + 50. Each one rebuilds a shorter list than the
    // last, and the cursor id from the previous pass is always gone from it.
    for (let pass = 0; pass < 3; pass++) await w.ctx.loadHistory();

    assert.equal(w.state.queried.length, total,
        'every URL in the window must be walked exactly once');
    assert.equal(w.ctx.calendar_storage2[day], total,
        'the heat map must hold the whole window, not a segment short of it');
    assert.equal(stateAt(session).cursor, null,
        'a finished window must clear its cursor');
});

test('a pass that finds the window already walked still publishes what was counted', async () => {
    // The shape the reviewer spotted: checkpoints are keyed on a count and the
    // cursor on an id, so a pass can leave a cursor sitting on the last entry of
    // the queue. The pass resuming it then walks nothing — `walked === 0` — even
    // though an earlier pass has counts waiting in the accumulator.
    //
    // The badge and the heat map want opposite things here, which is why neither
    // is keyed on `walked`. The badge has to be cleared (nothing is in flight);
    // the counts have to be published, or the window is thrown away after being
    // paid for. The window is also marked swept, since there is nothing left of
    // it to walk.
    const session = new Map();
    const total = CRAWL_BUDGET_URLS + 50;
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);

    await crawlUrls({
        sessionStore: session,
        urls: urlList(total),
        getVisits: visitsFor([visitAt(3, 1)]),
    });
    assert.equal(stateAt(session).heat[day], CRAWL_BUDGET_URLS);

    seedState(session, {
        cursor: { id: 'id' + (total - 1), pos: total - 1, at: Date.now() },
        heat: stateAt(session).heat,
    });
    const w = loadWorker({ sessionStore: session, getVisits: visitsFor([visitAt(3, 1)]) });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = urlList(total);
    await w.ctx.processVisits();

    assert.equal(w.state.queried.length, 0, 'the cursor sits at the end: nothing left to walk');
    assert.equal(w.ctx.calendar_storage2[day], CRAWL_BUDGET_URLS,
        'what the finished part of the window counted must still reach the map');
    assert.deepEqual({ ...stateAt(session).heat }, {},
        'and the accumulator must not outlive the window it belongs to');
    assert.equal(w.state.badges[w.state.badges.length - 1], '',
        'a pass that walks nothing must still clear the badge');
});

test('a window smaller than one pass still records the sweep', async () => {
    // The budget must not become a permanent "never finished": a small window
    // is complete in one pass, and that has to be recorded or every later pass
    // re-walks it.
    const session = new Map();
    await crawlUrls({ sessionStore: session, urls: urlList(3) });

    assert.ok(stateAt(session).sweepAt > 0, 'a completed window must be recorded');
    assert.equal(stateAt(session).cursor, null,
        'and must not leave a cursor pointing past its own end');
});

test('a pass after a completed sweep only looks at what arrived since', async () => {
    // Why a high frequency is affordable: without this, every pass would cost
    // the whole window again and raising the frequency would only multiply the
    // cost.
    const session = new Map();
    seedState(session, { sweepAt: Date.now() });

    const urls = urlList(4).map(function (u, i) {
        // Two visited before the sweep, two after.
        return Object.assign({}, u, { lastVisitTime: Date.now() + (i < 2 ? -1000 : 1000) });
    });
    const w = await crawlUrls({ sessionStore: session, urls: urls });

    assert.deepEqual(w.state.queried, [
        'https://example.com/2',
        'https://example.com/3',
    ], 'a URL already crawled by the sweep must not be crawled again');
});

test('a sweep older than its TTL is not trusted', async () => {
    // Otherwise the first pass would be the last one for as long as the browser
    // stayed open, and everything new would wait forever.
    const session = new Map();
    seedState(session, { sweepAt: Date.now() - CRAWL_SWEEP_TTL - 1000 });
    const urls = urlList(3).map(function (u) {
        return Object.assign({}, u, { lastVisitTime: Date.now() - 5000 });
    });

    const w = await crawlUrls({ sessionStore: session, urls: urls });

    assert.equal(w.state.queried.length, 3, 'an expired sweep must not skip anything');
});

test('a resumed pass walks the whole window, not just what is new', async () => {
    // The one case the sweep must NOT narrow: a pass that is resuming from a
    // cursor is the continuation of a walk that did not finish, so filtering it
    // down to "new since the sweep" would drop exactly the URLs it was going to
    // cover.
    const session = new Map();
    seedState(session, {
        sweepAt: Date.now(),
        cursor: { id: 'id0', pos: 0, at: Date.now() },
    });
    const urls = urlList(3).map(function (u) {
        return Object.assign({}, u, { lastVisitTime: Date.now() - 5000 });
    });

    const w = await crawlUrls({ sessionStore: session, urls: urls });

    assert.deepEqual(w.state.queried, [
        'https://example.com/1',
        'https://example.com/2',
    ], 'a resumed walk must not be filtered by the sweep');
});

test('a cursor whose URL has left the list is still a resumed window', async () => {
    // The sweep filter is safe only on a walk that starts from nothing: it
    // throws away everything older than the sweep, which is precisely the URLs
    // an unfinished walk still owes. So "should the sweep narrow this pass" and
    // "is there a window to finish" have to be the same question — and a cursor
    // that no longer resolves still answers yes to the second one.
    const session = new Map();
    seedState(session, {
        sweepAt: Date.now(),
        cursor: { id: 'walked-and-gone', pos: 999, at: Date.now() },
    });
    const urls = urlList(3).map(function (u) {
        return Object.assign({}, u, { lastVisitTime: Date.now() - 5000 });
    });

    const w = await crawlUrls({ sessionStore: session, urls: urls });

    assert.equal(w.state.queried.length, 3,
        'an unresolvable cursor resumes a walk; the sweep must not narrow it');
});

// ---------------------------------------------------------------------------
// The single versioned state object
//
// These are the shape guards for the convergence itself. They are behaviour
// checks (not source regexes) so they fail on the exact regression they name:
// a write that split back into three keys, a stale version half-restored, or
// counts kept without the cursor they belong to.
// ---------------------------------------------------------------------------

test('every crawl write lands in the one versioned key, never a key trio', async () => {
    const session = new Map();
    const total = CRAWL_BUDGET_URLS + 50;
    await crawlUrls({ sessionStore: session, urls: urlList(total) });

    const keys = [...session.keys()];
    assert.deepEqual(keys.filter((k) => k.startsWith('crawl-')), [CRAWL_STATE_KEY],
        'the three old keys must not come back');
    const saved = stateAt(session);
    assert.equal(saved.v, CRAWL_STATE_VERSION, 'the snapshot carries its shape version');
    assert.deepEqual(Object.keys(saved).sort(), ['cursor', 'heat', 'sweepAt', 'v'],
        'cursor, counts and sweep are fields of one object');
});

test('an unknown version is discarded wholesale instead of half-restored', async () => {
    // An older build left a snapshot with a different shape. Restoring half of
    // it (say the sweep, but not the cursor that says the walk is unfinished)
    // is how a completed-window claim used to skip URLs still in the queue.
    const session = new Map();
    seedState(session, {
        v: CRAWL_STATE_VERSION + 1,
        cursor: { id: 'id0', pos: 0, at: Date.now() },
        heat: { 1: 9 },
        sweepAt: Date.now(),
    });
    const w = await crawlUrls({ sessionStore: session, urls: urlList(3) });

    assert.equal(w.state.queried.length, 3, 'a stale shape must start a fresh full window');
    assert.equal(stateAt(session).v, CRAWL_STATE_VERSION, 'and be rewritten in the current shape');
});

test('counts with no live cursor are dropped, not carried into a new window', async () => {
    // A hand-edited / half-written object, or a cursor whose TTL expired while
    // its counts did not: those numbers belong to a walk that no longer exists,
    // and adding them to a fresh window would publish a never-correctable sum.
    const session = new Map();
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    seedState(session, { heat: { [day]: 999 } });  // no cursor

    const w = loadWorker({ sessionStore: session, getVisits: visitsFor([visitAt(3, 1)]) });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = urlList(1);
    await w.ctx.processVisits();

    assert.equal(w.ctx.calendar_storage2[day], 1,
        'the new window counts its own visit only, not the orphaned 999');
    assert.equal(stateAt(session).heat[day], undefined);
});

test('an expired cursor takes its counts with it', async () => {
    const session = new Map();
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    seedState(session, {
        cursor: { id: 'id0', pos: 0, at: Date.now() - CRAWL_CURSOR_TTL - 1000 },
        heat: { [day]: 999 },
    });

    const w = loadWorker({ sessionStore: session, getVisits: visitsFor([visitAt(3, 1)]) });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = urlList(3);
    await w.ctx.processVisits();

    assert.equal(w.state.queried.length, 3, 'an expired cursor must not resume anything');
    assert.equal(w.ctx.calendar_storage2[day], 3,
        'and its stale counts must not be added to the fresh window');
});

test('one set() per checkpoint: cursor and counts cannot be torn apart', async () => {
    // The failure mode the convergence removes: two writers, one for the
    // cursor and one for the heat, with a worker recycle possible between
    // them. Count how many times the ONE key was written during a long pass and
    // assert every snapshot carries both fields together.
    const session = new Map();
    const total = CRAWL_CHECKPOINT_URLS + 100;
    const snaps = [];
    const w = loadWorker({
        sessionStore: session,
        getVisits: visitsFor([visitAt(3, 1)]),
        sessionOverrides: {
            set(obj) {
                if (Object.prototype.hasOwnProperty.call(obj, CRAWL_STATE_KEY)) {
                    snaps.push(JSON.parse(JSON.stringify(obj[CRAWL_STATE_KEY])));
                }
                for (const [k, v] of Object.entries(obj)) session.set(k, v);
                return Promise.resolve();
            },
        },
    });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.urls_wait_load = urlList(total);
    await w.ctx.processVisits();

    assert.ok(snaps.length >= 2, 'a long pass checkpoints and then finishes');
    const checkpoints = snaps.filter((snap) => snap.cursor !== null);
    const closing = snaps.filter((snap) => snap.cursor === null);
    assert.ok(checkpoints.length >= 1, 'at least one mid-pass checkpoint');
    assert.equal(closing.length, 1, 'and one write that closes the window');
    for (const snap of checkpoints) {
        assert.ok(Object.keys(snap.heat).length > 0,
            'the checkpoint commits the counts gathered beside its cursor in the SAME write');
        assert.equal(snap.v, CRAWL_STATE_VERSION);
    }
    // The closing write records the sweep and clears the cursor/counts together.
    assert.ok(closing[0].sweepAt > 0, 'the closing write records the sweep');
    assert.deepEqual(closing[0].heat, {}, 'and drops the accumulator atomically');
    // Mutation: if saveCrawlState() wrote the cursor in one set() and the heat
    // in another, a checkpoint above would be missing its counts.
});

test('a sweep is never stored beside a live cursor', async () => {
    // Closing a window used to be two writes to two keys: clear the cursor,
    // then record the sweep. A recycle between them left a sweep claiming URLs
    // whose cursor was still queued. Now they are fields of one object, and
    // the snapshot that records the sweep has cursor === null.
    const session = new Map();
    await crawlUrls({ sessionStore: session, urls: urlList(3) });
    const saved = stateAt(session);
    assert.ok(saved.sweepAt > 0, 'the window was closed and swept');
    assert.equal(saved.cursor, null, 'in the same object, with no cursor left over');
    assert.deepEqual({ ...saved.heat }, {}, 'and no orphaned counts');
});

test('the crawl alarm is armed once and repeats', async () => {
    // Pacing is what raised the frequency, so the alarm has to exist — and it
    // has to survive a restart of the worker without being re-armed every time,
    // which would keep pushing its next firing into the future.
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    const armed = w.state.alarms.filter((a) => a.name === 'crawlHistory');
    assert.equal(armed.length, 1, 'the crawl alarm must be created on start');
    assert.equal(armed[0].info.periodInMinutes, CRAWL_PERIOD_MINUTES,
        'and it must repeat, or there is no second pass');

    // The restart half, and the reason it used to prove nothing: `loadWorker()`
    // builds a fresh `state.alarms` array per worker, so a second worker that
    // re-armed the alarm still "finds one" in its own empty list. The alarm
    // lives in the browser, not in the worker, so the test has to put it there:
    // the store is shared, and it starts out armed.
    //
    // Mutation-checked: change scheduleCrawl() to create unconditionally and
    // this goes red (the shared store then holds two entries).
    const store = w.state.alarms;
    const again = loadWorker({ tabs: [], alarmStore: store });
    again.boot();
    await again.settle();

    assert.equal(store.filter((a) => a.name === 'crawlHistory').length, 1,
        'an existing alarm must be left alone, or a worker that wakes often never lets it fire');
    assert.deepEqual(again.state.alarms, store, 'the second worker must read the same alarm store');
});

test('the mostVisited alarm is armed once, like the crawl one', async () => {
    // It used to be created unconditionally in initializeStorageState(), which
    // runs on EVERY worker wake-up. alarms.create() restarts the countdown, so
    // a worker woken by browsing more often than once per period kept pushing
    // the next firing into the future and the alarm never fired at all. That
    // also silently disabled sweepNegativeCache(), which is piggybacked on it.
    // The crawl alarm was already protected by scheduleCrawl(); mostVisited has
    // to use the same guard.
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    const armed = w.state.alarms.filter((a) => a.name === 'mostVisited');
    assert.equal(armed.length, 1, 'the mostVisited alarm must be created on start');
    assert.equal(armed[0].info.periodInMinutes, 30,
        'and it must still repeat every 30 minutes, or there is no second refresh');

    // The alarm lives in the browser, not in the worker. A fresh worker shares
    // the same alarm store and must leave the existing one alone. Mutation-
    // checked: reverting to an unconditional create() puts two entries here.
    const store = w.state.alarms;
    const again = loadWorker({ tabs: [], alarmStore: store });
    again.boot();
    await again.settle();

    assert.equal(store.filter((a) => a.name === 'mostVisited').length, 1,
        'an existing mostVisited alarm must not be re-armed on every start');
    assert.equal(store.filter((a) => a.name === 'crawlHistory').length, 1,
        'and the crawl alarm must still be armed exactly once');
});

// ---------------------------------------------------------------------------
// Retention cleanup (load-range3)
// ---------------------------------------------------------------------------

test('the mostVisited alarm enforces load-range3 on the database and the heat map', async () => {
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    const now = Date.now();
    const DAY = 24 * 3600 * 1000;
    w.ctx.localStorage['load-range3'] = '30';

    // Two heat-map days: one well outside the 30-day window, one inside it.
    // dayKey is the worker's own helper, so the keys are in the exact shape
    // saveCrawledHeat()/history() write.
    const oldKey = String(w.ctx.dayKey(now - 60 * DAY));
    const freshKey = String(w.ctx.dayKey(now - 5 * DAY));
    w.ctx.calendar_storage2[oldKey] = 12;
    w.ctx.calendar_storage2[freshKey] = 7;
    w.ctx.localStorage['calendar-storage2'] = JSON.stringify(w.ctx.calendar_storage2);

    w.fire('alarms.onAlarm', { name: 'mostVisited' });
    await w.settle();

    assert.equal(w.state.purgedAt.length, 1, 'the alarm must run the database sweep');
    const cutoff = w.state.purgedAt[0];
    assert.ok(Math.abs(cutoff - (now - 30 * DAY)) < 5000,
        'the cutoff must be load-range3 days before now');

    assert.equal(w.ctx.calendar_storage2[oldKey], undefined,
        'a heat-map day older than the retention window must be dropped');
    assert.equal(w.ctx.calendar_storage2[freshKey], 7,
        'a day still inside the window must be kept');
    // The map is persisted back so other contexts see the same pruned set.
    assert.equal(JSON.parse(w.ctx.localStorage['calendar-storage2'])[oldKey], undefined);

    assert.ok(w.sessionStore.has('retention-cleanup'),
        'the sweep must be stamped so the next wake-up skips it');
});

test('retention cleanup runs at most once a day', async () => {
    const session = new Map();
    const w = loadWorker({ tabs: [], sessionStore: session });
    w.boot();
    await w.settle();
    w.ctx.localStorage['load-range3'] = '30';

    w.fire('alarms.onAlarm', { name: 'mostVisited' });
    await w.settle();
    assert.equal(w.state.purgedAt.length, 1);

    // A fresh worker later in the same browser session shares the marker.
    const again = loadWorker({ tabs: [], sessionStore: session });
    again.boot();
    await again.settle();
    again.ctx.localStorage['load-range3'] = '30';
    again.fire('alarms.onAlarm', { name: 'mostVisited' });
    await again.settle();

    assert.equal(again.state.purgedAt.length, 0,
        'a sweep already done today must not run again on the next wake-up');
});

test('load-range3 = 0 keeps the cache forever', async () => {
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();
    w.ctx.localStorage['load-range3'] = '0';

    w.fire('alarms.onAlarm', { name: 'mostVisited' });
    await w.settle();

    assert.equal(w.state.purgedAt.length, 0, '0 means no retention sweep');
    assert.equal(w.sessionStore.has('retention-cleanup'), false);
});

test('load-range3 = 1 keeps the cutoff day but drops the day before it', async () => {
    // The heat map is keyed by dayKey() (the day's 23:59:59.999), while the
    // database sweep uses the raw instant now - days*DAY. Both halves must
    // answer "does this day still have data?" in their own units, so the
    // heat-map boundary is aligned down to a whole day before the compare.
    // A fixed clock keeps the edge from drifting across midnight mid-test:
    //   now = 2026-05-15 14:30, cutoff = 05-14 14:30,
    //   heat boundary = 05-14 00:00 (NOT the raw cutoff, NOT 23:59:59.999).
    const FIXED = new Date(2026, 4, 15, 14, 30, 0, 0).getTime();
    class FixedDate extends Date {
        static now() { return FIXED; }
    }
    const DAY = 24 * 3600 * 1000;
    const w = loadWorker({ tabs: [], Date: FixedDate });

    // Spy on the internal helper: the point of this fix is the *boundary
    // handed to it*. Deletion outcomes alone are equivalent for dayKey-shaped
    // keys under either boundary, so they cannot prove the alignment happened.
    const seen = [];
    const realPrune = w.ctx.pruneHeatMap;
    w.ctx.pruneHeatMap = function (boundary) {
        seen.push(boundary);
        return realPrune(boundary);
    };

    w.boot();
    await w.settle();
    w.ctx.localStorage['load-range3'] = '1';

    const keyFor = (daysAgo) => String(w.ctx.dayKey(FIXED - daysAgo * DAY));
    const todayKey = keyFor(0);
    const yesterdayKey = keyFor(1);   // the cutoff day itself
    const beforeKey = keyFor(2);      // first fully-expired day
    const longAgoKey = keyFor(40);
    for (const k of [todayKey, yesterdayKey, beforeKey, longAgoKey]) {
        w.ctx.calendar_storage2[k] = 5;
    }
    w.ctx.localStorage['calendar-storage2'] = JSON.stringify(w.ctx.calendar_storage2);

    w.fire('alarms.onAlarm', { name: 'mostVisited' });
    await w.settle();

    // The alignment itself: midnight of the cutoff day, not the raw instant.
    const cutoffDayStart = (() => { const d = new Date(FIXED - DAY); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    assert.equal(seen.length, 1, 'the heat map must be pruned once for this sweep');
    assert.equal(seen[0], cutoffDayStart,
        'the heat-map boundary must be aligned to the cutoff day 00:00, not the raw now - days*DAY');
    // -1 ms would land on the previous day's 23:59:59.999 and keep one day
    // too many: a coloured cell for a day whose visits were just swept.
    assert.equal(seen[0], w.ctx.dayKey(cutoffDayStart - 1) + 1,
        'the boundary must be the instant right after the previous day ends');

    // The database half must still receive the instantaneous cutoff, not the
    // day-aligned one: visitTime is a real timestamp, not a day bucket.
    assert.equal(w.state.purgedAt.length, 1);
    assert.equal(w.state.purgedAt[0], FIXED - DAY,
        'the DB sweep keeps the raw instant cutoff');

    assert.equal(w.ctx.calendar_storage2[todayKey], 5, 'today is never pruned');
    assert.equal(w.ctx.calendar_storage2[yesterdayKey], 5,
        'the cutoff day still has visits from the afternoon, so its cell stays');
    assert.equal(w.ctx.calendar_storage2[beforeKey], undefined,
        'the day before the cutoff lost every visit and must lose its cell too');
    assert.equal(w.ctx.calendar_storage2[longAgoKey], undefined,
        'older days are dropped as before');
    const persisted = JSON.parse(w.ctx.localStorage['calendar-storage2']);
    assert.equal(persisted[beforeKey], undefined,
        'the pruned set is persisted back for the other contexts');
});

test('a crawl alarm runs a pass', async () => {
    // The listener half: an alarm that is armed but never starts anything is
    // worse than no alarm, because nothing reports the difference.
    //
    // The queue is built by `loadHistory()` from the database stub rather than
    // handed to `urls_wait_load`, so this covers the whole path an alarm
    // triggers. `loadHistory` is replaced by a recorder for the same reason the
    // other cases replace `chrome.history`: the crawl's own contract is tested
    // elsewhere, and what is under test here is that the alarm reaches it.
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    const calls = [];
    const real = w.ctx.loadHistory;
    w.ctx.loadHistory = async function () { calls.push(1); return real.apply(this, arguments); };

    w.fire('alarms.onAlarm', { name: 'crawlHistory' });
    for (let i = 0; i < 30 && calls.length === 0; i++) await w.settle(1);

    assert.equal(calls.length, 1, 'the crawl alarm must start a pass');
});

test('two passes started at once walk the window once', async () => {
    // The shape that made this a real double-crawl rather than a theoretical
    // one: a worker woken by the crawl alarm runs loadDate() -> loadHistory()
    // from onStorageReady(), and the alarm branch starts its own loadHistory()
    // in the same turn. Both interleave, so the second one rebuilds
    // `urls_wait_load` under the first and every URL in the overlap is asked
    // for its visits twice. `heatDays` gets reset by both, so the surviving
    // walk writes a count missing the other half — and a heat map entry is
    // never overwritten, so nothing corrects it afterwards.
    let queries = 0;
    const urls = urlList(6);
    const w = loadWorker({
        tabs: [],
        queryURLs: () => { queries++; return Promise.resolve(urls.slice()); },
    });
    w.ctx.localStorage['load-range'] = '7';

    await Promise.all([w.ctx.loadHistory(), w.ctx.loadHistory()]);

    assert.equal(queries, 1,
        'the URL list must be read once, not once per caller');
    assert.deepEqual(w.state.queried, urls.map((u) => u.url),
        'every URL must reach getVisits() exactly once');
});

test('a failed pass does not wedge the crawl', async () => {
    // The guard is a flag, so the one way it can do real damage is by staying
    // up: a pass that rejects would then stop the crawl for the life of the
    // worker, and the worker is recycled long before anything would notice.
    // (A pass that merely *fails* is not enough to show this — the reads
    // inside it catch their own errors — so this one throws out of the walk.)
    let passes = 0;
    const w = loadWorker({
        tabs: [],
        queryURLs: () => Promise.resolve(urlList(2)),
    });
    w.ctx.localStorage['load-range'] = '7';

    const realProcess = w.ctx.processVisits;
    w.ctx.processVisits = function () {
        passes++;
        if (passes === 1) throw new Error('the walk exploded');
        return realProcess.apply(this, arguments);
    };

    await w.ctx.loadHistory();
    assert.ok(w.state.errors.some((e) => /pass failed/.test(e)),
        'a pass that throws must be logged, not left as an unhandled rejection');
    await w.ctx.loadHistory();

    assert.equal(passes, 2, 'the next pass must get its own attempt');
    assert.equal(w.state.queried.length, 2, 'and it must actually crawl');
});

test('an empty pass does not persist the previous window\'s live counts', async () => {
    // The steady state the reviewer described: one worker finishes a window
    // (its live `heatDays` still holds the counts — the e2e probes read them),
    // then the next alarm runs an empty pass with nothing new to walk. The
    // empty pass must not write anything, or it would snapshot that live
    // accumulator into the stored `heat` of a window that has no cursor —
    // an orphan count the next checkpoint would add to its own sum.
    const session = new Map();
    const day = dayKeyOf(Date.now() - 3 * DAY_MS);
    const w = loadWorker({ sessionStore: session, getVisits: visitsFor([visitAt(3, 1)]) });
    w.ctx.localStorage['load-range'] = '7';

    w.ctx.urls_wait_load = urlList(3);
    await w.ctx.processVisits();
    assert.equal(w.ctx.calendar_storage2[day], 3, 'the window was counted and published');
    assert.deepEqual({ ...w.ctx.heatDays }, { [day]: 3 },
        'the live accumulator still holds the count after the window closes');
    assert.deepEqual({ ...stateAt(session).heat }, {},
        'and the stored state has no counts beside its null cursor');

    const writes = [];
    const realSet = w.ctx.chrome.storage.session.set;
    w.ctx.chrome.storage.session.set = function (obj) {
        writes.push(Object.keys(obj));
        return realSet.call(this, obj);
    };
    w.ctx.urls_wait_load = [];
    await w.ctx.processVisits();

    assert.deepEqual(writes, [], 'an empty pass must not touch session storage');
    assert.deepEqual({ ...stateAt(session).heat }, {},
        'the stored counts must still be empty after the empty pass');
    assert.deepEqual({ ...w.ctx.heatDays }, {},
        'the empty pass hydrates the live accumulator from the fresh window');
    assert.equal(w.state.badges[w.state.badges.length - 1], '',
        'and the badge is still cleared');
});

test('saveCrawlState() persists only the heat it is handed', async () => {
    // No implicit fallback: a caller that omits `heat` must not get the live
    // module accumulator snapshotted into storage. The pass always passes it
    // explicitly now, so this is a direct check that the fallback is gone.
    const session = new Map();
    const w = loadWorker({ sessionStore: session });
    w.ctx.localStorage['load-range'] = '7';
    w.ctx.heatDays['999'] = 42;

    await w.ctx.saveCrawlState({ v: CRAWL_STATE_VERSION, cursor: null, heat: { '111': 7 }, sweepAt: 0 });
    assert.deepEqual({ ...stateAt(session).heat }, { '111': 7 },
        'only the explicit heat is stored');

    // A checkpoint with a live cursor passes `heatDays` itself; an empty object
    // closes the window without touching the live accumulator.
    await w.ctx.saveCrawlState({
        v: CRAWL_STATE_VERSION, cursor: { id: 'x', pos: 1, at: Date.now() },
        heat: w.ctx.heatDays, sweepAt: 0,
    });
    assert.deepEqual({ ...stateAt(session).heat }, { '999': 42 },
        'the live accumulator is passed explicitly, not read implicitly');
    assert.deepEqual({ ...w.ctx.heatDays }, { '999': 42 },
        'and closing writes never mutate the live accumulator');
});

test('a pass with nothing to walk still clears the badge', async () => {
    // An empty pass is the steady state once passes are periodic: after a
    // completed sweep, "nothing new since then" is the normal outcome. Every
    // path here has already written `Url` (loadDate() handing the badge over)
    // or a `D<n>`, so a pass that returns early leaves that marker on the
    // toolbar until the next non-empty pass — and since each period is one more
    // empty pass, that is where it stays.
    const w = loadWorker({ tabs: [] });
    w.ctx.urls_wait_load = [];
    w.ctx.setBadge('Url', true);

    await w.ctx.processVisits();

    assert.equal(w.state.badges[w.state.badges.length - 1], '',
        'an empty pass must end with the badge cleared');
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

test('the crawl alarm does not sweep the negative cache', async () => {
    // Both branches share one listener, so "fell through to the other one" is
    // the cheapest way to merge them; it would smuggle an O(cache) sweep into
    // every paced crawl pass and go unreported, since the sweep's own case only
    // ever fires the mostVisited alarm.
    const w = loadWorker({ tabs: [] });
    w.boot();
    await w.settle();

    const stale = 'https://icons.duckduckgo.com/ip3/stale.test.ico';
    w.ctx.setNegativeCache({ [stale]: Date.now() - NEGATIVE_CACHE_TTL - 1 });

    const swept = [];
    const real = w.ctx.sweepNegativeCache;
    w.ctx.sweepNegativeCache = function () { swept.push(1); return real.apply(this, arguments); };

    w.fire('alarms.onAlarm', { name: 'crawlHistory' });
    for (let i = 0; i < 30; i++) await w.settle(1);

    assert.equal(swept.length, 0, 'a crawl pass must not pay for the negative-cache sweep');
    assert.ok(stale in negCache(w), 'and the entry it would have dropped must still be there');
});

// ---------------------------------------------------------------------------
// Favicon shared cache
//
// `favicon-cache.internal/shared/<host>` is consulted by EVERY service before
// its own URL, so a value written there is trusted across services. The primary
// path only admits a response when `response.ok === true`; an opaque response
// (status 0, e.g. a 404 from a service that answers with an image) cannot be
// verified and must never reach the shared key. The fallback path used to write
// unconditionally for both `ok` and `opaque`, poisoning the shared cache for
// any later service on that hostname.
// ---------------------------------------------------------------------------

const SHARED_KEY = /const FAVICON_SHARED_KEY_PREFIX = '([^']+)'/.exec(SW_SRC)[1];

/** A Response-ish object whose `.clone()` keeps the same shape. */
function faviconResponse(ok, type) {
    const make = () => ({ ok, type, clone: () => make() });
    return make();
}

/** A duckduckgo icon URL whose hostname is `example.test`. */
const PRIMARY_URL = 'https://icons.duckduckgo.com/ip3/example.test.ico';

/**
 * Drive handleFaviconRequest() with a failing primary and a configured
 * fallback, and return the cache keys that were written.
 *
 * `primary` deliberately fails (ok=false, type='basic', i.e. an HTTP error)
 * so the handler goes down the fallback branch — that is the branch under test.
 * The fallback's own response is `fallbackResponse`.
 */
async function sharedCacheWritesFor(fallbackResponse) {
    const puts = [];
    let call = 0;
    const w = loadWorker({
        faviconCachePuts: puts,
        faviconFetch: async () => {
            call++;
            // First fetch is the primary (network failure), second is the
            // fallback service. Both go through the same stub.
            return call === 1
                ? faviconResponse(false, 'basic')
                : fallbackResponse;
        },
    });
    // A fallback service must be configured, or the handler returns before
    // reaching fetchFaviconFallback() and the case would pass for the wrong
    // reason. `google` produces a URL matching FAVICON_SERVICE_PATTERNS.
    w.ctx.localStorage['favicon-service-fallback'] = 'google';
    w.boot();
    await w.settle();

    const result = await w.ctx.handleFaviconRequest(new w.ctx.Request(PRIMARY_URL));
    return { puts, result, call };
}

test('an opaque fallback response is not written to the shared cache', async () => {
    // Regression for review #2: fetchFaviconFallback() used to write the
    // shared key for `(ok || type === 'opaque')`. An opaque response cannot be
    // verified, so that single write poisoned every later service's icon for
    // the same hostname. The exact-URL cache is still fine — it is scoped to
    // this one service URL.
    const { puts, result, call } = await sharedCacheWritesFor(faviconResponse(false, 'opaque'));

    assert.equal(call, 2, 'the fallback must actually have been fetched');
    assert.ok(result, 'an opaque fallback is still returned to the page');
    assert.ok(puts.includes('https://www.google.com/s2/favicons?sz=64&domain_url=https%3A%2F%2Fexample.test%2F'),
        'the exact-URL cache must still hold the fallback icon');
    assert.ok(!puts.some((u) => u.startsWith(SHARED_KEY)),
        `an opaque response must not reach the shared cache; wrote ${JSON.stringify(puts)}`);
});

test('a successful fallback response is written to the shared cache', async () => {
    // The same branch must keep its useful behaviour: a verifiable success is
    // worth sharing across services. Without this case, "delete both writes"
    // would also make the regression case above pass.
    const { puts, result, call } = await sharedCacheWritesFor(faviconResponse(true, 'basic'));

    assert.equal(call, 2, 'the fallback must actually have been fetched');
    assert.ok(result, 'a successful fallback is returned to the page');
    assert.ok(puts.includes(SHARED_KEY + 'example.test'),
        `a response.ok fallback must populate the shared key; wrote ${JSON.stringify(puts)}`);
});

test('the primary and fallback paths apply the same shared-cache rule', async () => {
    // Two writers, one invariant. Driving the primary with an opaque response
    // and the fallback with an opaque response must produce the exact same
    // decision about the shared key; a future edit that fixes only one of them
    // leaves the other half of the bug. Both still write their own exact URL.
    const puts = [];
    const w = loadWorker({
        faviconCachePuts: puts,
        faviconFetch: async () => faviconResponse(false, 'opaque'),
    });
    w.ctx.localStorage['favicon-service-fallback'] = 'google';
    w.boot();
    await w.settle();

    // Primary succeeds as opaque -> handleFaviconRequest() returns before the
    // fallback is reached, so the shared key must be absent.
    await w.ctx.handleFaviconRequest(new w.ctx.Request(PRIMARY_URL));
    assert.ok(!puts.some((u) => u.startsWith(SHARED_KEY)),
        `primary: opaque must not reach the shared cache; wrote ${JSON.stringify(puts)}`);
    assert.ok(puts.includes(PRIMARY_URL), 'primary: the exact-URL cache is still written');

    // Now force the fallback branch and confirm the same verdict there.
    puts.length = 0;
    let call = 0;
    w.ctx.fetch = async () => {
        call++;
        return call === 1 ? faviconResponse(false, 'basic') : faviconResponse(false, 'opaque');
    };
    await w.ctx.handleFaviconRequest(new w.ctx.Request(PRIMARY_URL));
    assert.ok(!puts.some((u) => u.startsWith(SHARED_KEY)),
        `fallback: opaque must not reach the shared cache; wrote ${JSON.stringify(puts)}`);
});
