// Storage Adapter for Manifest V3 Migration
// Replaces localStorage with a cached interface backed by chrome.storage.local

(function () {
    const globalObj = typeof window !== 'undefined' ? window : self;

    const adapter = {
        _cache: {},
        _initialized: false,
        _initializing: false,
        _initCallbacks: [],
        _resolveReady: null,
        readyPromise: null,

        init(callback) {
            if (callback) {
                if (this._initialized) {
                    callback();
                } else {
                    this._initCallbacks.push(callback);
                }
            }

            if (this._initialized) {
                return this.readyPromise;
            }

            if (this._initializing) {
                return this.readyPromise;
            }

            this._initializing = true;

            chrome.storage.local.get(null, (items) => {
                this._cache = items || {};
                this._initialized = true;
                this._initializing = false;

                if (this._resolveReady) {
                    this._resolveReady();
                    this.readyPromise = Promise.resolve();
                    this._resolveReady = null;
                }

                const callbacks = this._initCallbacks.slice();
                this._initCallbacks.length = 0;
                callbacks.forEach((cb) => {
                    try {
                        cb();
                    } catch (err) {
                        console.error('storageAdapter callback error', err);
                    }
                });
            });

            return this.readyPromise;
        },

        ready(callback) {
            return this.init(callback);
        },

        getItem(key) {
            return this._cache[key];
        },

        setItem(key, value) {
            this._cache[key] = value;
            chrome.storage.local.set({ [key]: value });
        },

        removeItem(key) {
            delete this._cache[key];
            chrome.storage.local.remove(key);
        },

        clear() {
            this._cache = {};
            chrome.storage.local.clear();
        },

        key(index) {
            const keys = Object.keys(this._cache);
            return keys[index] || null;
        },

        get length() {
            return Object.keys(this._cache).length;
        }
    };

    adapter.readyPromise = new Promise((resolve) => {
        adapter._resolveReady = resolve;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') {
            return;
        }
        Object.keys(changes).forEach((key) => {
            const change = changes[key];
            if ('newValue' in change) {
                adapter._cache[key] = change.newValue;
            } else {
                delete adapter._cache[key];
            }
        });
    });

    const storageProxy = new Proxy(adapter, {
        get(target, prop) {
            if (prop in target) {
                return target[prop];
            }
            return target.getItem(String(prop));
        },
        set(target, prop, value) {
            if (prop in target) {
                target[prop] = value;
            } else {
                target.setItem(String(prop), value);
            }
            return true;
        },
        deleteProperty(target, prop) {
            target.removeItem(String(prop));
            return true;
        },
        has(target, prop) {
            return prop in target || prop in target._cache;
        },
        ownKeys(target) {
            return Object.keys(target._cache);
        },
        getOwnPropertyDescriptor(target, prop) {
            if (prop in target._cache) {
                return {
                    enumerable: true,
                    configurable: true,
                    value: target._cache[prop]
                };
            }
            return undefined;
        }
    });

    globalObj.storageAdapter = adapter;
    globalObj.localStorageAdapter = storageProxy;

    let overrideSucceeded = false;
    try {
        delete globalObj.localStorage;
        Object.defineProperty(globalObj, 'localStorage', {
            get() {
                return storageProxy;
            },
            set() {},
            configurable: true,
            enumerable: true
        });
        overrideSucceeded = true;
    } catch (error) {
        console.warn('Unable to override localStorage, falling back to localStorageAdapter alias', error);
    }

    if (!overrideSucceeded && typeof globalObj.localStorage === 'undefined') {
        globalObj.localStorage = storageProxy;
    }

    globalObj.onStorageReady = function (callback) {
        return adapter.ready(callback);
    };

    adapter.init();
})();
