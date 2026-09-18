// Behaviour tests for chrome/scripts/storage-adapter.js
//
// Classic script + singleton on `window`, so — as with db-manager.js — it is
// evaluated in a fresh `node:vm` context against a fake `chrome.storage.local`.
//
// The fake's `get()` deliberately does *not* answer immediately: it parks the
// callback so each test can decide when initialisation completes. That window
// is the whole subject here — every read before it returns `undefined`, and
// code cannot distinguish "not loaded yet" from "genuinely unset". The P0 bug
// where updateFilter() overwrote a saved list came straight out of it, so the
// adapter now collects those keys and says so once, at completion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../chrome/scripts/storage-adapter.js', import.meta.url), 'utf8');

/**
 * Evaluate the adapter in a fresh context.
 *
 * @param {object} [initial] what chrome.storage.local already holds.
 * @returns an object whose `flush()` completes the pending read.
 */
function loadAdapter(initial = {}) {
    const store = { ...initial };
    const warnings = [];
    const pendingGets = [];
    const chrome = {
        storage: {
            local: {
                get(keys, cb) { pendingGets.push(cb); },
                set(items) { Object.assign(store, items); },
                remove(key) { delete store[key]; },
                clear() { for (const k of Object.keys(store)) delete store[k]; },
            },
            onChanged: { addListener() {} },
        },
        runtime: {},
    };
    const win = {};
    const ctx = {
        window: win,
        chrome,
        console: {
            info() {}, log() {}, error() {},
            warn(message) { warnings.push(String(message)); },
        },
    };
    vm.createContext(ctx);
    new vm.Script(SRC, { filename: 'storage-adapter.js' }).runInContext(ctx);

    return {
        win,
        adapter: win.storageAdapter,
        localStorage: win.localStorage,
        warnings,
        store,
        /** Answer the parked chrome.storage.local.get(null, …). */
        flush() {
            const cbs = pendingGets.splice(0);
            for (const cb of cbs) cb({ ...store });
        },
    };
}

test('a read before the cache exists yields undefined and is recorded', () => {
    const env = loadAdapter({ 'page-zoom': '120' });

    assert.equal(env.localStorage['page-zoom'], undefined, 'nothing is readable before the cache is filled');
    assert.ok(
        Array.from(env.adapter._unreadyReads).includes('page-zoom'),
        'the key must be recorded so the window is visible',
    );
});

test('reads after completion are not recorded', () => {
    const env = loadAdapter({ 'page-zoom': '120' });
    env.localStorage['page-zoom']; // early: recorded above
    env.flush();

    assert.equal(env.localStorage['page-zoom'], '120');
    // An unset key still reads as undefined — that is the legitimate "unset"
    // answer, and reporting it would drown the real signal in noise.
    assert.equal(env.localStorage['never-configured'], undefined);
    assert.ok(
        !Array.from(env.adapter._unreadyReads).includes('never-configured'),
        'only reads from before completion are unready',
    );
});

test('unready reads are reported once, at completion', () => {
    const env = loadAdapter({ 'page-zoom': '120', 'popup-zoom': '90' });
    env.localStorage['page-zoom'];
    env.localStorage['popup-zoom'];
    assert.deepEqual(env.warnings, [], 'reporting happens at completion, not per read');

    env.flush();

    const matches = env.warnings.filter((w) => w.includes('page-zoom'));
    assert.equal(matches.length, 1, `expected exactly one warning, got ${JSON.stringify(env.warnings)}`);
    assert.match(matches[0], /2 key\(s\) read before storage was ready/);
    assert.match(matches[0], /popup-zoom/, 'the other offending key must be named too');
});

test('a long list of unready reads is summarised rather than dumped', () => {
    const env = loadAdapter();
    for (let i = 0; i < 8; i++) env.localStorage['key-' + i];
    env.flush();

    assert.equal(env.warnings.length, 1);
    assert.match(env.warnings[0], /8 key\(s\)/);
    assert.match(env.warnings[0], /\+3 more\)/, 'the tail is counted, not listed');
});

test('nothing is reported when no key was read early', () => {
    const env = loadAdapter({ 'page-zoom': '120' });
    env.flush();
    env.localStorage['page-zoom'];

    assert.deepEqual(env.warnings, [], 'a healthy page must stay quiet');
});

test('onStorageReady callbacks run once the cache is populated', () => {
    const env = loadAdapter();
    const seen = [];
    env.win.onStorageReady(() => seen.push('ready'));

    assert.deepEqual(seen, [], 'the callback must not run before the read lands');
    env.flush();
    assert.deepEqual(seen, ['ready']);
});

test('treating the adapter as an object does not look like a read', () => {
    // The proxy funnels *every* property access through getItem(), including
    // the probes the language performs: `await` asks for `then`,
    // JSON.stringify asks for `toJSON`, and symbols arrive stringified.
    // Recording those would fill the warning with names nobody ever wrote,
    // and the whole point of the warning is that it stays readable.
    const env = loadAdapter();
    void env.localStorage.then;
    void JSON.stringify(env.localStorage);
    void env.localStorage[Symbol.iterator];

    env.flush();
    assert.deepEqual(env.warnings, [], 'language probes must not be reported as unready reads');
});

test('the unready set does not outlive its report', () => {
    const env = loadAdapter();
    env.localStorage['page-zoom'];
    env.flush();

    assert.equal(env.adapter._unreadyReads.size, 0, 'keeping them invites a second report of the same reads');
});

test('every stored value comes back as a string', () => {
    // The property proxy is what page scripts actually touch, and every
    // comparison downstream (`=== 'yes'`, `Number(...)`) assumes this.
    const env = loadAdapter();
    env.flush();

    env.localStorage['rh-itemsno'] = 42;
    env.localStorage['rh-search'] = true;

    assert.equal(env.localStorage['rh-itemsno'], '42');
    assert.equal(env.localStorage['rh-search'], 'true');
    assert.equal(env.store['rh-itemsno'], '42', 'the value persisted to chrome.storage is stringified too');
});
