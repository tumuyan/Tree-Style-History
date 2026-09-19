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
            onChanged: { addListener() {} },
        },
        tabs: {
            query: (_q, cb) => cb(state.tabs),
            onCreated: ev('tabs.onCreated'),
            onUpdated: ev('tabs.onUpdated'),
            onActivated: ev('tabs.onActivated'),
            onRemoved: ev('tabs.onRemoved'),
        },
        history: {
            search: (_q, cb) => cb([]),
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
        localStorage: {},
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
