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
//
// It also answers with a SNAPSHOT taken at call time, not with whatever the
// store holds when it finally delivers — the deviation from the real thing is
// spelled out on `get()` below, and nowhere else.

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
    const errors = [];
    const pending = [];
    let onChangedListener = null;
    const chrome = {
        storage: {
            local: {
                // Snapshot at call time, like Chrome — NOT the live store when
                // the callback finally runs. Anything written in between must be
                // absent from the answer, or the pending-write races below are
                // unobservable (which is how they stayed green for months).
                get(keys, cb) { pending.push({ cb, snapshot: { ...store } }); },
                set(items) { Object.assign(store, items); },
                remove(key) { delete store[key]; },
                clear() { for (const k of Object.keys(store)) delete store[k]; },
            },
            // Captured so a case can impersonate the *other* context (the
            // Service Worker) delivering a change while this one boots.
            onChanged: { addListener(fn) { onChangedListener = fn; } },
        },
        runtime: {},
    };
    const win = {};
    const ctx = {
        window: win,
        chrome,
        console: {
            info() {}, log() {},
            error(message) { errors.push(String(message)); },
            warn(message) { warnings.push(String(message)); },
        },
    };
    vm.createContext(ctx);
    new vm.Script(SRC, { filename: 'storage-adapter.js' }).runInContext(ctx);
    // The adapter overrides `localStorage` on its `globalObj` — which, with a
    // `window` in scope, is this sandbox's `window` object, NOT the context's
    // own global. A bare `localStorage[...]` inside the vm resolves against the
    // latter, so wire the proxy across or `evalStrict()` would be assigning to
    // `undefined` while looking like it exercises the `set` trap.
    vm.runInContext('globalThis.localStorage = window.localStorage;', ctx);

    return {
        win,
        adapter: win.storageAdapter,
        localStorage: win.localStorage,
        warnings,
        errors,
        store,
        flush() {
            for (const item of pending.splice(0)) item.cb(item.snapshot);
        },
        /** Pretend chrome.storage.onChanged fired, as another context would. */
        onChanged(changes) {
            onChangedListener(changes, 'local');
        },
        /**
         * Run `body` inside the vm context under strict mode.
         *
         * This file is an ES module, so every assignment written here is already
         * strict — but the *page* is what the adapter has to behave for, and a
         * classic script is sloppy by default. Evaluating inside the context is
         * how a case can pick the strict side on purpose.
         */
        evalStrict(body) {
            return vm.runInContext(`'use strict'; (function () {${body}})()`, ctx);
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

test('a write made before the cache exists is not rolled back by the answer', () => {
    // The initial chrome.storage.local.get(null) is issued at script evaluation,
    // and anything writing to localStorage in between persists *before* that
    // read returns — so the snapshot it arrives with does not contain the write.
    // Handing the snapshot straight to `_cache` therefore undoes it: the value
    // is gone from memory even though it survived in storage.
    const env = loadAdapter({ 'page-zoom': '100' });
    env.localStorage['page-zoom'] = '150';

    env.flush();

    assert.equal(env.localStorage['page-zoom'], '150', 'a write must be readable back by whoever made it');
    assert.equal(env.store['page-zoom'], '150', 'and it was persisted to chrome.storage');
});

test('a later write supersedes the snapshot either way', () => {
    // The reverse order — the answer precedes the write — must also end up with
    // the written value, otherwise whichever runs first would decide the outcome.
    const env = loadAdapter({ 'page-zoom': '100' });
    env.flush();
    env.localStorage['page-zoom'] = '150';

    assert.equal(env.localStorage['page-zoom'], '150');
});

test('a removal made before the cache exists is not resurrected', () => {
    // The mirror image of the write race above, and it was hiding behind the
    // same flaw in this harness: `delete localStorage[k]` removes it from
    // storage immediately, but the initial get()'s snapshot still contains the
    // old value, so handing the snapshot to `_cache` brings it back.
    const env = loadAdapter({ 'rh-pinned': '[]' });
    delete env.localStorage['rh-pinned'];

    env.flush();

    assert.equal(env.localStorage['rh-pinned'], undefined);
    assert.ok(!('rh-pinned' in env.store), 'and it was removed from chrome.storage');
});

test('the interface loses to no storage key', () => {
    // `localStorage[x]` reaches `adapter.getItem(x)`, so a value stored under a
    // name the adapter already owns cannot be read back — the member shadows it
    // on every access, silently and forever. Refusing the write at least says so.
    const env = loadAdapter();
    env.flush();
    // Called outside the trap's own module, so this file's strict mode applies
    // and the refusal throws — see the next case for the return value itself.
    assert.throws(
        () => { env.localStorage['getItem'] = 'owned-by-storage'; },
        TypeError,
        'a refused write must not look like a successful one',
    );

    assert.equal(
        env.errors.filter((e) => e.includes('refusing to store')).length,
        1,
        `expected one collision error, got ${JSON.stringify(env.errors)}`,
    );
    assert.equal(typeof env.localStorage.getItem, 'function', 'the member must not have been overwritten');
    assert.equal(env.localStorage['getItem'], env.adapter.getItem, 'reading it back still yields the member');
    assert.ok(!('getItem' in env.store), 'and the refused value never reached chrome.storage');
});

test('the refused assignment reports failure instead of pretending', () => {
    // A `set` trap that returns `true` after logging tells the caller the write
    // succeeded; in strict mode it would be a TypeError. Code doing
    // `localStorage['getItem'] = x` then believes the value is saved, which is
    // the silent half of the collision.
    const env = loadAdapter();
    env.flush();

    const refusal = env.evalStrict(`
        try {
            localStorage['getItem'] = 'owned-by-storage';
            return 'accepted';
        } catch (err) {
            return err.name + ': ' + err.message;
        }
    `);

    assert.match(
        refusal,
        /^TypeError: /,
        `a strict-mode caller must see the refusal, got: ${refusal}`,
    );
});

test('an ordinary reserved-looking key is still stored', () => {
    // The guard above must not swallow keys that merely begin with `_`, which is
    // how several storage keys are spelled today.
    const env = loadAdapter();
    env.flush();
    env.localStorage['_internal'] = 'fine';

    assert.deepEqual(env.errors, [], 'only names the adapter actually owns are reserved');
    assert.equal(env.localStorage['_internal'], 'fine');
});

test('a change delivered from another context survives the snapshot', () => {
    // setItem()/removeItem() were the only writers this race knew about, but
    // they are not the only way a key changes: another context (the SW's
    // `defaultConfig()` on startup) writes through chrome.storage, and this one
    // hears about it via onChanged — which only touched `_cache`, so applying
    // the pending snapshot wholesale still threw the change away.
    const env = loadAdapter({ 'rh-itemsno': '25' });
    env.onChanged({ 'rh-itemsno': { newValue: '77' } });

    env.flush();

    assert.equal(env.localStorage['rh-itemsno'], '77', 'the delivered change must not be rolled back');
});

test('a removal delivered from another context is not resurrected', () => {
    // The same race, mirrored: onChanged with no `newValue` means the key was
    // removed elsewhere, and the snapshot still holds the old value.
    const env = loadAdapter({ 'rh-itemsno': '25' });
    env.onChanged({ 'rh-itemsno': { oldValue: '25' } });

    env.flush();

    assert.equal(env.localStorage['rh-itemsno'], undefined);
});

test('onChanged after completion lands without touching the pending map', () => {
    // The recording is only meaningful during the window; afterwards there is no
    // snapshot left to replay into, so the map must stay empty.
    const env = loadAdapter();
    env.flush();
    env.onChanged({ 'rh-itemsno': { newValue: '77' } });

    assert.equal(env.localStorage['rh-itemsno'], '77');
    assert.equal(env.adapter._pendingWrites.size, 0, 'nothing may be recorded once the cache is filled');
});

test('a long-lived adapter does not accumulate pending removals', () => {
    // `removeItem()` used to record unconditionally while `setItem()` did not,
    // so every removal after startup pushed an entry into a map nobody reads
    // again — background-sw.js removes `favicon-negative-cache` on demand.
    const env = loadAdapter();
    env.flush();
    env.localStorage.removeItem('favicon-negative-cache');

    assert.equal(env.adapter._pendingWrites.size, 0, 'an entry recorded now could never be replayed');
});
