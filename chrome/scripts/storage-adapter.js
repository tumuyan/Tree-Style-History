// Storage Adapter for Manifest V3 Migration
// Replaces localStorage with a cached interface backed by chrome.storage.local

(function () {
    const globalObj = typeof window !== 'undefined' ? window : self;

    // === Popup timing tracking ===
    const _pageStartTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (globalObj.document) {
        globalObj.document.addEventListener('DOMContentLoaded', function _onDCL() {
            var elapsed = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _pageStartTime;
            console.info('[Popup] HTML load → DOMContentLoaded:', elapsed.toFixed(1) + 'ms');
            globalObj.document.removeEventListener('DOMContentLoaded', _onDCL);
        });
    }
    globalObj._htmlStartTime = _pageStartTime;

    const toStorageString = (value) => {
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (value === null) {
            return 'null';
        }
        if (value === undefined) {
            return 'undefined';
        }
        // For objects (including arrays), mimic localStorage behavior
        // by calling toString() which yields [object Object] unless overridden.
        try {
            return String(value);
        } catch (error) {
            console.warn('storageAdapter: failed to stringify value', error);
            return '';
        }
    };

    const normalizeItems = (items) => {
        const normalized = {};
        const updates = {};
        if (!items) {
            return { normalized, updates };
        }
        Object.keys(items).forEach((key) => {
            const value = items[key];
            const stringValue = toStorageString(value);
            normalized[key] = stringValue;
            if (value !== stringValue) {
                updates[key] = stringValue;
            }
        });
        return { normalized, updates };
    };

    const adapter = {
        _cache: {},
        _initialized: false,
        _initializing: false,
        _initCallbacks: [],
        _resolveReady: null,
        _initStartTime: 0,
        readyPromise: null,

        init(callback) {
            if (this._initialized) {
                if (callback) callback();
                return this.readyPromise;
            }

            if (this._initializing) {
                if (callback) this._initCallbacks.push(callback);
                return this.readyPromise;
            }

            this._initStartTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            console.info('[StorageAdapter] === Initialization START ===');
            console.info('[StorageAdapter] Service Worker context:', typeof globalObj.location !== 'undefined' ? globalObj.location.protocol : 'unknown');
            this._initializing = true;

            if (callback) {
                this._initCallbacks.push(callback);
            }

            fetchFromStorage();

            return this.readyPromise;
        },

        ready(callback) {
            return this.init(callback);
        },

        getItem(key) {
            const value = this._cache[key];
            if (value === undefined) {
                return undefined;
            }
            return value;
        },

        setItem(key, value) {
            const stringValue = toStorageString(value);
            this._cache[key] = stringValue;
            chrome.storage.local.set({ [key]: stringValue });
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
        
        const { normalized, updates } = normalizeItems(items);
        adapter._cache = normalized;
        adapter._initialized = true;
        adapter._initializing = false;

        if (Object.keys(updates).length > 0 && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set(updates);
        }

        if (adapter._resolveReady) {
            adapter._resolveReady();
            adapter.readyPromise = Promise.resolve();
            adapter._resolveReady = null;
        }

        const callbacks = adapter._initCallbacks.slice();
        adapter._initCallbacks.length = 0;
        
        const cacheSize = Object.keys(adapter._cache).length;
        const duration = now() - startTime;
        const totalDuration = adapter._initStartTime ? now() - adapter._initStartTime : duration;
        const elapsed = (typeof duration === 'number' && typeof duration.toFixed === 'function') ? duration.toFixed(2) : duration;
        const totalElapsed = (typeof totalDuration === 'number' && typeof totalDuration.toFixed === 'function') ? totalDuration.toFixed(2) : totalDuration;
        console.info(`[StorageAdapter] === Initialization COMPLETE ===`);
        console.info(`[StorageAdapter]   Cache keys: ${cacheSize}`);
        console.info(`[StorageAdapter]   Normalize time: ${elapsed}ms`);
        console.info(`[StorageAdapter]   Total init time: ${totalElapsed}ms`);
        
        callbacks.forEach((cb, idx) => {
            try {
                cb();
            } catch (err) {
                console.error('storageAdapter callback error [' + idx + ']', err, (cb.name || 'anonymous'));
            }
        });
    }

    function fetchFromStorage() {
        const fallbackToStorage = () => {
            console.info('[StorageAdapter] Path: COLD START (fallback to chrome.storage.local)');
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now.bind(performance) : Date.now;
            const t0 = now();
            chrome.storage.local.get(null, (items) => {
                const elapsed = (now() - t0).toFixed(2);
                console.info(`[StorageAdapter] chrome.storage.local.get(null) completed in ${elapsed}ms`);
                completeInitialization(items);
            });
        };

        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getBackgroundPage === 'function') {
            try {
                chrome.runtime.getBackgroundPage((bg) => {
                    const reasons = [];
                    if (chrome.runtime.lastError) reasons.push('lastError: ' + chrome.runtime.lastError.message);
                    if (!bg) reasons.push('bg is falsy');
                    if (bg && bg === globalObj) reasons.push('bg === globalObj (SW not available)');
                    if (bg && !bg.storageAdapter) reasons.push('bg.storageAdapter missing');
                    if (bg && bg.storageAdapter && !bg.storageAdapter._initialized) reasons.push('bg.storageAdapter not initialized');

                    if (reasons.length > 0) {
                        console.info('[StorageAdapter] Path: COLD START (getBackgroundPage rejected)');
                        console.info('[StorageAdapter]   Reasons:', reasons.join('; '));
                        fallbackToStorage();
                        return;
                    }

                    console.info('[StorageAdapter] Path: HOT START (background cache)');
                    try {
                        const cloned = JSON.parse(JSON.stringify(bg.storageAdapter._cache || {}));
                        const keyCount = Object.keys(cloned).length;
                        console.info(`[StorageAdapter]   Retrieved ${keyCount} keys from background page cache`);
                        completeInitialization(cloned);
                    } catch (error) {
                        console.warn('[StorageAdapter] Failed to clone background cache, falling back', error);
                        fallbackToStorage();
                    }
                });
                return;
            } catch (error) {
                console.warn('[StorageAdapter] getBackgroundPage threw exception', error);
            }
        } else {
            console.info('[StorageAdapter] chrome.runtime.getBackgroundPage not available');
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
                adapter._cache[key] = ('newValue' in change) ? toStorageString(change.newValue) : adapter._cache[key];
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
