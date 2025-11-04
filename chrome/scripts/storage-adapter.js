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
                    return this.readyPromise;
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

            console.debug('storageAdapter: starting initialization...');
            this._initializing = true;
            fetchFromStorage();

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

    function completeInitialization(items) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now.bind(performance) : Date.now;
        const startTime = now();
        
        adapter._cache = items || {};
        adapter._initialized = true;
        adapter._initializing = false;

        if (adapter._resolveReady) {
            adapter._resolveReady();
            adapter.readyPromise = Promise.resolve();
            adapter._resolveReady = null;
        }

        const callbacks = adapter._initCallbacks.slice();
        adapter._initCallbacks.length = 0;
        
        const cacheSize = Object.keys(adapter._cache).length;
        const duration = now() - startTime;
        const elapsed = (typeof duration === 'number' && typeof duration.toFixed === 'function') ? duration.toFixed(2) : duration;
        console.debug(`storageAdapter: initialized with ${cacheSize} keys in ${elapsed}ms`);
        
        callbacks.forEach((cb) => {
            try {
                cb();
            } catch (err) {
                console.error('storageAdapter callback error', err);
            }
        });
    }

    function fetchFromStorage() {
        const fallbackToStorage = () => {
            chrome.storage.local.get(null, (items) => {
                console.debug('storageAdapter: loading data from chrome.storage.local');
                completeInitialization(items);
            });
        };

        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getBackgroundPage === 'function') {
            try {
                chrome.runtime.getBackgroundPage((bg) => {
                    if (chrome.runtime.lastError || !bg || bg === globalObj || !bg.storageAdapter || !bg.storageAdapter._initialized) {
                        fallbackToStorage();
                        return;
                    }

                    try {
                        const cloned = JSON.parse(JSON.stringify(bg.storageAdapter._cache || {}));
                        console.debug('storageAdapter: using background cache for initialization');
                        completeInitialization(cloned);
                    } catch (error) {
                        console.warn('storageAdapter: failed to clone background cache', error);
                        fallbackToStorage();
                    }
                });
                return;
            } catch (error) {
                console.warn('storageAdapter: getBackgroundPage failed', error);
            }
        }

        fallbackToStorage();
    }

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
    } catch (error) {
        console.warn('storageAdapter: unable to delete localStorage property', error);
    }

    try {
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
        console.warn('storageAdapter: unable to redefine localStorage property', error);
    }

    if (!overrideSucceeded) {
        try {
            globalObj.localStorage = storageProxy;
            overrideSucceeded = true;
        } catch (error) {
            console.warn('storageAdapter: unable to assign localStorage proxy directly', error);
        }
    }

    if (!overrideSucceeded) {
        console.error('storageAdapter: failed to override window.localStorage. Use window.localStorageAdapter instead.');
    }

    globalObj.onStorageReady = function (callback) {
        return adapter.ready(callback);
    };

    adapter.init();
})();
