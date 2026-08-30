// Shared helpers for the node:test suite.
//
// Why stubs are needed
// --------------------
// chrome/scripts/modules/*.js are ES modules that touch browser globals at
// *import* time (e.g. config.js calls updateFilter() at top level, which reads
// localStorage). Modules must therefore be imported with `await import(...)`
// AFTER installStubs() has run — a static `import` would be hoisted above it.
//
// The localStorage stub deliberately mimics the real StorageAdapter semantics:
// every value is coerced to a string (storage-adapter.js:19-40). Code in this
// project depends on that (`localStorage['rh-itemsno'] == 16` is false, but
// `Number(...) == 16` is true), so the stub must not preserve JS types.

const CHROME_DIR = new URL('../chrome/', import.meta.url).pathname;

export { CHROME_DIR };

/**
 * Install minimal browser-ish globals. Returns a handle so tests can inspect
 * and mutate the fake storage.
 */
export function installStubs() {
    const store = new Map();

    const localStorageStub = {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : undefined),
        setItem: (k, v) => { store.set(String(k), String(v)); },
        removeItem: (k) => { store.delete(String(k)); },
        clear: () => store.clear(),
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
    };

    // Mirror the real StorageAdapter: property access proxies to the map and
    // values are stringified on the way in.
    const localStorageProxy = new Proxy(localStorageStub, {
        get: (t, p) => (p in t ? t[p] : store.get(String(p))),
        set: (t, p, v) => { store.set(String(p), String(v)); return true; },
        deleteProperty: (t, p) => { store.delete(String(p)); return true; },
        has: (t, p) => p in t || store.has(String(p)),
        ownKeys: () => Array.from(store.keys()),
        getOwnPropertyDescriptor(t, p) {
            if (store.has(String(p))) {
                return { enumerable: true, configurable: true, value: store.get(String(p)) };
            }
            return undefined;
        },
    });

    const syncStore = new Map();
    const storageArea = (map) => ({
        get: (keys, cb) => {
            const out = {};
            if (keys === null || keys === undefined) {
                for (const [k, v] of map) out[k] = v;
            } else {
                const list = Array.isArray(keys) ? keys : [keys];
                for (const k of list) if (map.has(k)) out[k] = map.get(k);
            }
            if (cb) cb(out);
            return Promise.resolve(out);
        },
        set: (obj, cb) => { for (const [k, v] of Object.entries(obj)) map.set(k, v); if (cb) cb(); return Promise.resolve(); },
        remove: (k, cb) => { map.delete(k); if (cb) cb(); return Promise.resolve(); },
        clear: (cb) => { map.clear(); if (cb) cb(); return Promise.resolve(); },
    });

    const chromeStub = {
        runtime: {
            id: 'test-extension-id',
            lastError: undefined,
            getManifest: () => ({ version: '3.3.1', manifest_version: 3 }),
            sendMessage: () => Promise.resolve(undefined),
            getURL: (p) => `chrome-extension://test-extension-id/${p}`,
        },
        i18n: {
            getMessage: (key) => key, // echo the key: deterministic and lets tests assert wiring
            getUILanguage: () => 'en',
        },
        storage: {
            local: storageArea(store),
            sync: storageArea(syncStore),
            onChanged: { addListener() {} },
        },
        history: { search: (_q, cb) => cb && cb([]), getVisits: (_q, cb) => cb && cb([]) },
        tabs: { query: (_q, cb) => cb && cb([]) },
    };

    const documentStub = {
        getElementById: () => null,
        querySelectorAll: () => [],
        querySelector: () => null,
        createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }),
        addEventListener() {},
        body: {},
    };

    globalThis.localStorage = localStorageProxy;
    globalThis.chrome = chromeStub;
    globalThis.document = documentStub;
    if (!globalThis.window) globalThis.window = globalThis;

    return {
        store,
        syncStore,
        localStorage: localStorageProxy,
        chrome: chromeStub,
        reset() { store.clear(); syncStore.clear(); },
    };
}

/** Import an extension ES module with the stubs already in place. */
export function importModule(relPath) {
    return import(new URL(`../chrome/scripts/${relPath}`, import.meta.url).href);
}

/**
 * Import a *fresh* instance by busting the ESM cache.
 *
 * Needed to observe module-evaluation side effects: ESM evaluates a module only
 * once per URL, so a second `importModule()` of the same file is a no-op.
 */
export function importModuleFresh(relPath) {
    const url = new URL(`../chrome/scripts/${relPath}`, import.meta.url).href;
    return import(`${url}?fresh=${Date.now()}-${Math.random()}`);
}
