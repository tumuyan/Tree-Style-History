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
    }

    close() {
        this.closed = true;
    }

    /** Records written to `name`, in order. */
    stored(name) {
        if (!this.written.has(name)) this.written.set(name, []);
        return this.written.get(name);
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
        tx.objectStore = (name) => ({
            put(record) { db.stored(name).push(record); return {}; },
        });
        // Completes asynchronously, like a real transaction.
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
    const ctx = { indexedDB, window: win, console, setTimeout, IDBKeyRange: {} };
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
