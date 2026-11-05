// Behaviour tests for chrome/scripts/db-manager.js
//
// db-manager.js is a classic script: an IIFE that publishes a singleton onto
// `window`/`self`. There is nothing to `import`, so each test evaluates it in a
// fresh `node:vm` context with a minimal fake IndexedDB — enough to drive the
// real init()/close()/deleteDB() control flow.
//
// The fake database throws InvalidStateError from transaction() once it has
// been closed, exactly like a real IDBDatabase. That is what makes the cached
// `_readyPromise` bug observable: without the fix, getDB() after deleteDB()
// resolves to the connection that was just closed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../chrome/scripts/db-manager.js', import.meta.url), 'utf8');

class FakeDatabase {
    constructor(version) {
        this.version = version;
        this.closed = false;
        // Real IDB exposes a DOMStringList here; db-manager only calls contains().
        const stores = ['VisitItem', 'urls', 'closed'];
        this.objectStoreNames = { contains: (n) => stores.includes(n) };
        this.transactions = 0;
        this.written = new Map(); // store name -> records put
        // Rows that already exist before a sweep. purgeExpired() walks these
        // through an index cursor; the fake sorts them by the indexed field.
        this.seeded = new Map();  // store name -> records
        this.deleted = new Map(); // store name -> keys deleted
    }

    close() {
        this.closed = true;
    }

    /** Records written to `name`, in order. */
    stored(name) {
        if (!this.written.has(name)) this.written.set(name, []);
        return this.written.get(name);
    }

    /** Preload rows the sweep should find. */
    seed(name, records) {
        this.seeded.set(name, records.slice());
    }

    deletedFrom(name) {
        if (!this.deleted.has(name)) this.deleted.set(name, []);
        return this.deleted.get(name);
    }

    transaction() {
        if (this.closed) {
            const err = new Error('InvalidStateError: the connection has been closed.');
            err.name = 'InvalidStateError';
            throw err;
        }
        this.transactions++;
        const db = this;
        const tx = { oncomplete: null, onerror: null, onabort: null };
        // A cursor per openCursor() call, advanced by continue() on a macrotask
        // so the sweep's per-row onsuccess handlers really run in sequence.
        tx.objectStore = (name) => ({
            put(record) { db.stored(name).push(record); return {}; },
            index(indexName) {
                return {
                    openCursor(range) {
                        const request = {};
                        const field = { visitTime: 'visitTime', lastVisitTime: 'lastVisitTime',
                            closeTime: 'closeTime' }[indexName] || indexName;
                        const upper = range && range.upper;
                        const rows = (db.seeded.get(name) || [])
                            .filter((r) => upper === undefined || r[field] <= upper)
                            .sort((a, b) => a[field] - b[field]);
                        // A synchronous cursor: continue() hands the next row
                        // straight back. Real IDB queues these, but nothing in
                        // purgeExpired() depends on the walk being async, and a
                        // fixed timer here would race transaction.oncomplete on
                        // a slow CI box.
                        let i = 0;
                        const step = () => {
                            if (!request.onsuccess) return;
                            if (i >= rows.length) {
                                request.onsuccess({ target: { result: null } });
                                return;
                            }
                            const value = rows[i++];
                            const cursor = {
                                value,
                                delete() { db.deletedFrom(name).push(value); },
                                continue: step,
                            };
                            request.onsuccess({ target: { result: cursor } });
                        };
                        // Microtask: it runs before the transaction's
                        // macrotask oncomplete, but after purgeExpired() has
                        // assigned request.onsuccess.
                        queueMicrotask(step);
                        return request;
                    },
                };
            },
        });
        // Completes asynchronously, like a real transaction, after the
        // cursor walks (setTimeout 0 above runs before this timeout).
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        return tx;
    }
}

function makeIndexedDB() {
    const state = { db: null, opens: 0, deletes: 0 };
    const indexedDB = {
        open(_name, version) {
            const request = {};
            // Async, like the real API — and late enough that init() has
            // finished assigning onsuccess/onupgradeneeded by the time it runs.
            setTimeout(() => {
                state.opens++;
                const db = new FakeDatabase(version);
                state.db = db;
                if (request.onupgradeneeded) request.onupgradeneeded({ target: { result: db } });
                if (request.onsuccess) request.onsuccess({ target: { result: db } });
            }, 0);
            return request;
        },
        deleteDatabase() {
            const request = {};
            setTimeout(() => {
                state.deletes++;
                if (state.db) state.db.close();
                state.db = null;
                if (request.onsuccess) request.onsuccess({ target: { result: undefined } });
            }, 0);
            return request;
        },
    };
    return { indexedDB, state };
}

/** Evaluate db-manager.js in a fresh context; return its singleton and the fake's state. */
function loadDbManager() {
    const { indexedDB, state } = makeIndexedDB();
    const win = {};
    const IDBKeyRange = { upperBound: (upper) => ({ upper }) };
    const ctx = { indexedDB, window: win, console, setTimeout, queueMicrotask, IDBKeyRange };
    ctx.self = ctx; // db-manager.js also publishes onto `self`
    vm.createContext(ctx);
    new vm.Script(SRC, { filename: 'db-manager.js' }).runInContext(ctx);
    return { dbManager: win.dbManager, state };
}

test('init() hands out one connection and reuses it', async () => {
    const { dbManager, state } = loadDbManager();
    const first = await dbManager.init();
    const second = await dbManager.getDB();

    assert.equal(state.opens, 1, 'a healthy singleton must not reopen the database');
    assert.equal(second, first);
    assert.equal(first.closed, false);
});

test('deleteDB() invalidates the cached connection', async () => {
    const { dbManager, state } = loadDbManager();
    const first = await dbManager.init();
    await dbManager.deleteDB();

    assert.equal(state.deletes, 1);
    assert.equal(first.closed, true, 'deleteDB() must close the connection it holds');

    const second = await dbManager.getDB();

    assert.equal(state.opens, 2, 'the next getDB() must reopen instead of replaying the old promise');
    assert.notEqual(second, first);
    assert.equal(second.closed, false);
    // The whole point: writes after "clear data" have to land on a live connection.
    assert.doesNotThrow(() => second.transaction(['VisitItem'], 'readwrite'));
    assert.throws(() => first.transaction(['VisitItem'], 'readwrite'), { name: 'InvalidStateError' });
});

// ---------------------------------------------------------------------------
// Batch writes
//
// The startup crawl writes tens of thousands of visit items. One transaction
// per record is the difference between seconds and minutes, so the batch API
// is not a convenience — it is the only way the crawl finishes before the
// service worker is recycled.
// ---------------------------------------------------------------------------

test('putVisitItems writes a whole batch in one transaction', async () => {
    const { dbManager, state } = loadDbManager();
    await dbManager.init();
    const before = state.db.transactions;

    const items = [
        { visitId: 1, url: 'https://a/' },
        { visitId: 2, url: 'https://b/' },
        { visitId: 3, url: 'https://c/' },
    ];
    await dbManager.putVisitItems(items);

    assert.equal(state.db.transactions - before, 1,
        'a batch must not cost one transaction per record');
    assert.deepEqual(state.db.stored('VisitItem'), items);
});

test('putURLs writes a whole batch in one transaction', async () => {
    const { dbManager, state } = loadDbManager();
    await dbManager.init();
    const before = state.db.transactions;

    const records = [{ id: 'a', url: 'https://a/' }, { id: 'b', url: 'https://b/' }];
    await dbManager.putURLs(records);

    assert.equal(state.db.transactions - before, 1);
    assert.deepEqual(state.db.stored('urls'), records);
});

test('an empty batch resolves without opening a transaction', async () => {
    const { dbManager, state } = loadDbManager();
    await dbManager.init();
    const before = state.db.transactions;

    await dbManager.putVisitItems([]);
    await dbManager.putURLs([]);

    assert.equal(state.db.transactions, before, 'no work means no transaction');
});

test('close() invalidates the cached connection too', async () => {
    const { dbManager, state } = loadDbManager();
    const first = await dbManager.init();
    dbManager.close();

    assert.equal(first.closed, true);

    const second = await dbManager.getDB();

    assert.equal(state.opens, 2);
    assert.notEqual(second, first);
    assert.equal(second.closed, false);
    assert.doesNotThrow(() => second.transaction(['urls'], 'readwrite'));
});

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------

test('purgeExpired drops old rows from all three stores and keeps recent ones', async () => {
    const { dbManager, state } = loadDbManager();
    await dbManager.init();

    const DAY = 24 * 3600 * 1000;
    const now = Date.now();
    state.db.seed('VisitItem', [
        { visitId: 1, visitTime: now - 60 * DAY },
        { visitId: 2, visitTime: now - 5 * DAY },
    ]);
    state.db.seed('urls', [
        { id: 'a', lastVisitTime: now - 60 * DAY },
        { id: 'b', lastVisitTime: now - 5 * DAY },
    ]);
    state.db.seed('closed', [
        { id: 'c', closeTime: now - 60 * DAY },
        { id: 'd', closeTime: now - 5 * DAY },
        // A still-open marker: closeTime 0. It is older than the cutoff by
        // timestamp but must survive — it belongs to the current session.
        { id: 'e', closeTime: 0, close: -1 },
    ]);

    const cutoff = now - 30 * DAY;
    const removed = await dbManager.purgeExpired(cutoff);

    assert.equal(removed, 3, 'one old row per store must be deleted');
    assert.deepEqual(state.db.deletedFrom('VisitItem').map((r) => r.visitId), [1]);
    assert.deepEqual(state.db.deletedFrom('urls').map((r) => r.id), ['a']);
    assert.deepEqual(state.db.deletedFrom('closed').map((r) => r.id), ['c'],
        'the still-open marker (closeTime 0) must not be swept');
});

test('purgeExpired uses the cutoff faithfully', async () => {
    const { dbManager, state } = loadDbManager();
    await dbManager.init();
    const now = Date.now();
    state.db.seed('VisitItem', [
        { visitId: 1, visitTime: now - 10 * 1000 },
        { visitId: 2, visitTime: now - 2 * 1000 },
    ]);
    state.db.seed('urls', []);
    state.db.seed('closed', []);

    const removed = await dbManager.purgeExpired(now - 5 * 1000);
    assert.equal(removed, 1, 'only the row at/older than the cutoff is dropped');
    assert.deepEqual(state.db.deletedFrom('VisitItem').map((r) => r.visitId), [1]);
});
