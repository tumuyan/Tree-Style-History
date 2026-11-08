// Storage Adapter for Manifest V3 Migration
// Replaces localStorage with a cached interface backed by chrome.storage.local

(function () {
    const globalObj = typeof window !== 'undefined' ? window : self;

    // One switch for the extension's diagnostic logs. Every page and the
    // service worker print a startup trace otherwise, which is noise in a
    // shipped extension. Off by default; set `self.DEBUG = true` (or
    // `window.DEBUG = true` in a page) in DevTools and reload to see them.
    // Warnings and errors are NOT routed through here — those are real problems.
    globalObj.DEBUG = false;
    globalObj.debugLog = function () {
        if (globalObj.DEBUG) console.log.apply(console, arguments);
    };

    // === Popup timing tracking ===
    const _pageStartTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (typeof window !== 'undefined') { window._htmlStartTime = _pageStartTime; }
    if (globalObj.document) {
        globalObj.document.addEventListener('DOMContentLoaded', function _onDCL() {
            var elapsed = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _pageStartTime;
            globalObj.debugLog('[Popup] HTML load → DOMContentLoaded:', elapsed.toFixed(1) + 'ms');
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
        // Keys read before the cache existed. Every one of them was answered
        // with `undefined`, and the caller cannot tell that apart from
        // "genuinely unset" — so the window is reported instead of ignored.
        _unreadyReads: new Set(),
        // Changes made before the initial `chrome.storage.local.get()` answered,
        // from this context (setItem/removeItem) or from another one (the SW's
        // `defaultConfig()`, delivered by chrome.storage.onChanged). That read
        // returns the pre-change snapshot, so without re-applying these the
        // change silently evaporates. Cleared once it has served its purpose.
        _pendingWrites: new Map(),

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
            globalObj.debugLog('[StorageAdapter] === Initialization START ===');
            globalObj.debugLog('[StorageAdapter] Service Worker context:', typeof globalObj.location !== 'undefined' ? globalObj.location.protocol : 'unknown');
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

        /**
         * @param {string}  key
         * @param {boolean} [record] whether an early miss should count as an
         *   unready read. The proxy turns *every* property access into a
         *   getItem() call, and language probes are not storage keys — see
         *   OBJECT_PROBES.
         */
        getItem(key, record = true) {
            const value = this._cache[key];
            if (value === undefined) {
                if (record && !this._initialized) {
                    this._unreadyReads.add(String(key));
                }
                return undefined;
            }
            return value;
        },

        /**
         * Read a stored value as a number, at the storage boundary.
         *
         * Callers read through `storageAdapter` and no longer need to know that
         * everything behind it is a string — the conversion is done once here,
         * rather than at every numeric comparison.
         *
         * Deliberately a mechanical `Number(getItem(key))`: an uncached key
         * (cold start) yields NaN and an empty string yields 0, exactly as the
         * call sites did. getNumber() also goes through getItem(), so an early
         * read is still reported as an unready read.
         */
        getNumber(key) {
            return Number(this.getItem(key));
        },

        setItem(key, value) {
            const stringValue = toStorageString(value);
            this._cache[key] = stringValue;
            // A write that happens before chrome.storage.local.get() answers is
            // persisted straight away, but the snapshot arriving afterwards does
            // not include it — so remember it and re-apply it, instead of letting
            // the older value roll the write back.
            if (!this._initialized) {
                this._pendingWrites.set(String(key), stringValue);
            }
            chrome.storage.local.set({ [key]: stringValue });
        },

        removeItem(key) {
            delete this._cache[key];
            // Same race as setItem(), mirrored — and guarded the same way: once
            // the cache is filled the snapshot can no longer resurrect anything,
            // and an entry added now would sit unread forever.
            if (!this._initialized) {
                this._pendingWrites.set(String(key), undefined);
            }
            chrome.storage.local.remove(key);
        },

        clear() {
            this._cache = {};
            this._pendingWrites.clear();
            chrome.storage.local.clear();
        },

        key(index) {
            const keys = Object.keys(this._cache);
            return keys[index] || null;
        },

        /**
         * All keys currently cached, as an array.
         *
         * The proxy exposes these through ownKeys/Object.keys(localStorage),
         * but a module that has moved to the explicit API should not have to
         * reach back through the illusion just to enumerate them. config.js
         * sweeps retired settings this way; keeping it here means that code
         * can be fully migrated without a second, implicit storage surface.
         */
        keys() {
            return Object.keys(this._cache);
        },

        /**
         * Whether the initial `chrome.storage.local.get(null)` snapshot has
         * filled the cache. Before that point getItem() answers `undefined`
         * for every key, so a reader cannot tell "not loaded yet" from
         * "genuinely unset" — exactly the ambiguity described on getItem().
         * Bulk readers that would write on a miss (defaultConfig()) must not
         * run in that window: their misses are not real misses, and the writes
         * would be replayed over the snapshot at completion.
         */
        isReady() {
            return this._initialized;
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
        // Anything written during the initial read lands in storage before that
        // read answers, and therefore is absent from `items`. Re-applying here is
        // what keeps `localStorage[k] = v` truthful in that window.
        for (const [key, value] of adapter._pendingWrites) {
            if (value === undefined) {
                delete adapter._cache[key];
            } else {
                adapter._cache[key] = value;
            }
        }
        adapter._pendingWrites.clear();
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
        globalObj.debugLog(`[StorageAdapter] === Initialization COMPLETE ===`);
        globalObj.debugLog(`[StorageAdapter]   Cache keys: ${cacheSize}`);
        globalObj.debugLog(`[StorageAdapter]   Normalize time: ${elapsed}ms`);
        globalObj.debugLog(`[StorageAdapter]   Total init time: ${totalElapsed}ms`);

        // Every read that happened before this line was answered `undefined`.
        // Say so before the callbacks run, so the warning precedes whatever
        // the page logs next.
        reportUnreadyReads();

        callbacks.forEach((cb, idx) => {
            try {
                cb();
            } catch (err) {
                console.error('storageAdapter callback error [' + idx + ']', err, (cb.name || 'anonymous'));
            }
        });
    }

    /**
     * Report the keys read before the cache existed, once.
     *
     * The set is cleared as part of reporting: nothing is left to accumulate,
     * and a later re-initialisation reports only its own window rather than
     * this one again on top of it.
     */
    function reportUnreadyReads() {
        const all = Array.from(adapter._unreadyReads);
        if (all.length === 0) {
            return;
        }
        adapter._unreadyReads.clear();

        const shown = all.slice(0, 5).join(', ');
        const rest = all.length > 5 ? ` (+${all.length - 5} more)` : '';
        console.warn(`[StorageAdapter] ${all.length} key(s) read before storage was ready: ${shown}${rest}`);
    }

    function fetchFromStorage() {
        const fallbackToStorage = () => {
            globalObj.debugLog('[StorageAdapter] Reading chrome.storage.local');
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now.bind(performance) : Date.now;
            const t0 = now();
            chrome.storage.local.get(null, (items) => {
                const elapsed = (now() - t0).toFixed(2);
                globalObj.debugLog(`[StorageAdapter] chrome.storage.local.get(null) completed in ${elapsed}ms`);
                completeInitialization(items);
            });
        };

        // There used to be a "hot start" branch here: it asked
        // chrome.runtime.getBackgroundPage() for the background page's cache
        // and cloned it instead of reading chrome.storage.local. That API is
        // MV2-only and does not exist in a Manifest V3 service worker, so the
        // branch could only ever log a reason and take this same path — on
        // every start, in every context.
        fallbackToStorage();
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') {
            return;
        }
        Object.keys(changes).forEach((key) => {
            const change = changes[key];
            const value = 'newValue' in change ? toStorageString(change.newValue) : undefined;
            // Before completion the initial `get()`'s snapshot is still on its
            // way, and applying it wholesale would discard this change. Record it
            // like a local write so it is replayed along with them.
            if (!adapter._initialized) {
                adapter._pendingWrites.set(key, value);
            }
            if (value === undefined) {
                delete adapter._cache[key];
            } else {
                adapter._cache[key] = value;
            }
        });
    });

    // Properties the language asks of *any* object before treating it as one.
    // Symbols are excluded by their type; these are the string names that
    // would otherwise surface in the warning as keys nobody ever wrote:
    // `await localStorage` probes `then`, JSON.stringify probes `toJSON`.
    const OBJECT_PROBES = new Set(['then', 'toJSON', 'constructor', 'prototype']);

    // Storage keys and adapter members share one namespace, and the adapter
    // owns the collision: `localStorage['getItem'] = x` would run
    // `target.getItem = x` (the `set` trap checks `prop in target` first) and
    // replace the method itself. The value is then never persisted — not to
    // chrome.storage.local, not into the initial snapshot — so it vanishes on
    // reload, while every later read of that name hands back `x` instead of a
    // stored string. Refusing the write at least says so out loud.
    const RESERVED_KEYS = new Set(
        Object.keys(adapter).filter((k) => !k.startsWith('_')),
    );

    const storageProxy = new Proxy(adapter, {
        get(target, prop) {
            if (prop in target) {
                return target[prop];
            }
            return target.getItem(String(prop), typeof prop === 'string' && !OBJECT_PROBES.has(prop));
        },
        set(target, prop, value) {
            // Checked before `prop in target`: the adapter owns these names, so
            // the plain assignment below would otherwise overwrite `getItem`
            // itself and leave no trace of the collision.
            if (typeof prop === 'string' && RESERVED_KEYS.has(prop)) {
                console.error(
                    'storageAdapter: refusing to store the key "' + prop
                    + '" — it names one of the adapter\'s own members, so writing it'
                    + ' would replace that member and never persist the value.',
                );
                // Returning false makes the assignment throw a TypeError in a
                // strict-mode caller, instead of quietly doing nothing.
                return false;
            }
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
