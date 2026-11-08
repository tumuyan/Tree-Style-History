// IndexedDB Manager for Tree Style History
// Provides unified database access for both the service worker and UI pages

(function() {
    'use strict';

    // Diagnostic logs go through the shared switch storage-adapter.js installs
    // on the global. When this file is evaluated on its own (tests, or a page
    // that forgot the adapter) the fallback is a no-op, never a ReferenceError.
    var debugLog = (typeof self !== 'undefined' && self.debugLog) || (typeof window !== 'undefined' && window.debugLog) || function () {};

    const DB_NAME = 'testDB';
    const DB_VERSION = 6;

    class DBManager {
        constructor() {
            this.db = null;
            this.isReady = false;
            this._readyCallbacks = [];
            this._readyPromise = null;
        }

        // Initialize database
        init() {
            if (this._readyPromise) {
                return this._readyPromise;
            }

            this._readyPromise = new Promise((resolve, reject) => {
                const indexedDBInstance = (typeof indexedDB !== 'undefined') ? indexedDB : (typeof window !== 'undefined' ? window.indexedDB : null);
                if (!indexedDBInstance) {
                    reject(new Error('IndexedDB is not available in this environment.'));
                    return;
                }
                const request = indexedDBInstance.open(DB_NAME, DB_VERSION);

                request.onerror = (event) => {
                    console.error('Error opening DB', event);
                    reject(event);
                };

                request.onupgradeneeded = (event) => {
                    debugLog('Upgrading DB to version', DB_VERSION);
                    const db = event.target.result;

                    // Create VisitItem store
                    if (!db.objectStoreNames.contains('VisitItem')) {
                        try {
                            const visitStore = db.createObjectStore('VisitItem', { keyPath: 'visitId' });
                            visitStore.createIndex('url', 'url', { unique: false });
                            visitStore.createIndex('visitTime', 'visitTime', { unique: false });
                            visitStore.createIndex('referringVisitId', 'referringVisitId', { unique: false });
                            visitStore.createIndex('title', 'title', { unique: false });
                            visitStore.createIndex('transition', 'transition', { unique: false });
                            debugLog('Created VisitItem store');
                        } catch (error) {
                            console.error('Error creating VisitItem store:', error);
                        }
                    }

                    // Create urls store
                    if (!db.objectStoreNames.contains('urls')) {
                        try {
                            const urlStore = db.createObjectStore('urls', { keyPath: 'id' });
                            urlStore.createIndex('url', 'url', { unique: false });
                            urlStore.createIndex('lastVisitTime', 'lastVisitTime', { unique: false });
                            urlStore.createIndex('title', 'title', { unique: false });
                            urlStore.createIndex('from_to', ['loadfrom', 'loadto'], { unique: false });
                            debugLog('Created urls store');
                        } catch (error) {
                            console.error('Error creating urls store:', error);
                        }
                    }

                    // Create closed store
                    if (!db.objectStoreNames.contains('closed')) {
                        try {
                            const closedStore = db.createObjectStore('closed', { keyPath: 'id' });
                            closedStore.createIndex('url', 'url', { unique: false });
                            closedStore.createIndex('title', 'title', { unique: false });
                            closedStore.createIndex('closeTime', 'closeTime', { unique: false });
                            closedStore.createIndex('close', 'close', { unique: false });
                            debugLog('Created closed store');
                        } catch (error) {
                            console.error('Error creating closed store:', error);
                        }
                    }
                };

                request.onsuccess = (event) => {
                    debugLog('Success opening DB');
                    this.db = event.target.result;
                    this.isReady = true;

                    // Execute callbacks
                    this._readyCallbacks.forEach(callback => {
                        try {
                            callback(this.db);
                        } catch (error) {
                            console.error('Error in ready callback:', error);
                        }
                    });
                    this._readyCallbacks = [];

                    resolve(this.db);
                };
            });

            return this._readyPromise;
        }

        // Get database instance (async)
        getDB() {
            if (this.isReady && this.db) {
                return Promise.resolve(this.db);
            }
            return this.init();
        }

        // Register callback for when DB is ready
        ready(callback) {
            if (this.isReady && this.db) {
                callback(this.db);
                return Promise.resolve(this.db);
            }

            this._readyCallbacks.push(callback);
            return this.init();
        }

        // Close database
        close() {
            if (this.db) {
                this.db.close();
                this.db = null;
                this.isReady = false;
            }
            // Drop the cached open() promise too. init() short-circuits on it,
            // so keeping it would make every later getDB() resolve to the
            // connection closed above — and transaction() on a closed
            // IDBDatabase throws InvalidStateError.
            this._readyPromise = null;
        }

        // Delete entire database
        deleteDB() {
            return new Promise((resolve, reject) => {
                if (this.db) {
                    this.db.close();
                    this.db = null;
                    this.isReady = false;
                }
                // Same reason as close(): the cached promise resolves to the
                // connection being destroyed here, so the next getDB() has to
                // reopen rather than replay it.
                this._readyPromise = null;

                const indexedDBInstance = (typeof indexedDB !== 'undefined') ? indexedDB : (typeof window !== 'undefined' ? window.indexedDB : null);
                if (!indexedDBInstance) {
                    reject(new Error('IndexedDB is not available in this environment.'));
                    return;
                }

                const deleteRequest = indexedDBInstance.deleteDatabase(DB_NAME);

                deleteRequest.onerror = (event) => {
                    console.error('Error deleting DB', event);
                    reject(event);
                };

                deleteRequest.onsuccess = (event) => {
                    debugLog('Successfully deleted DB');
                    resolve(event);
                };
            });
        }

        // Add or update a visit item
        putVisitItem(visitItem) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['VisitItem'], 'readwrite');
                    const store = transaction.objectStore('VisitItem');

                    const request = store.put(visitItem);

                    request.onsuccess = () => resolve(visitItem);
                    request.onerror = (event) => reject(event);
                });
            });
        }

        // Add or update a URL record
        putURL(urlRecord) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['urls'], 'readwrite');
                    const store = transaction.objectStore('urls');

                    const request = store.put(urlRecord);

                    request.onsuccess = () => resolve(urlRecord);
                    request.onerror = (event) => reject(event);
                });
            });
        }

        // Batch write: every record goes into ONE transaction. The startup
        // crawl writes tens of thousands of visit items, and a transaction per
        // record is the difference between seconds and minutes — each commit is
        // a durable write to the profile. It also keeps the service worker from
        // being recycled mid-crawl.
        putVisitItems(visitItems) {
            return this.putAll('VisitItem', visitItems);
        }

        putURLs(urlRecords) {
            return this.putAll('urls', urlRecords);
        }

        putAll(storeName, records) {
            if (!records || records.length === 0) {
                return Promise.resolve([]);
            }
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);

                    for (const record of records) {
                        store.put(record);
                    }

                    // Resolved from oncomplete, not from the last put(): a put
                    // request succeeding says nothing about the transaction
                    // having committed.
                    transaction.oncomplete = () => resolve(records);
                    transaction.onerror = (event) => reject(event);
                    transaction.onabort = (event) => reject(event);
                });
            });
        }

        // Add or update a closed tab record
        putClosedTab(closedRecord) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['closed'], 'readwrite');
                    const store = transaction.objectStore('closed');

                    const request = store.put(closedRecord);

                    request.onsuccess = () => resolve(closedRecord);
                    request.onerror = (event) => reject(event);
                });
            });
        }

        // Query closed tabs
        queryClosedTabs(options = {}) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['closed'], 'readonly');
                    const store = transaction.objectStore('closed');
                    const results = [];

                    let cursorRequest;
                    if (options.index && options.range) {
                        const index = store.index(options.index);
                        cursorRequest = index.openCursor(options.range, options.direction || 'prev');
                    } else {
                        cursorRequest = store.openCursor(null, options.direction || 'prev');
                    }

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            results.push(cursor.value);
                            if (!options.limit || results.length < options.limit) {
                                cursor.continue();
                            } else {
                                resolve(results);
                            }
                        } else {
                            resolve(results);
                        }
                    };

                    cursorRequest.onerror = (event) => reject(event);
                });
            });
        }

        // Query visit items
        queryVisitItems(options = {}) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['VisitItem'], 'readonly');
                    const store = transaction.objectStore('VisitItem');
                    const results = [];

                    let cursorRequest;
                    if (options.index && options.range) {
                        const index = store.index(options.index);
                        cursorRequest = index.openCursor(options.range, options.direction);
                    } else {
                        cursorRequest = store.openCursor(null, options.direction);
                    }

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            results.push(cursor.value);
                            if (!options.limit || results.length < options.limit) {
                                cursor.continue();
                            } else {
                                resolve(results);
                            }
                        } else {
                            resolve(results);
                        }
                    };

                    cursorRequest.onerror = (event) => reject(event);
                });
            });
        }

        // Query URLs
        queryURLs(options = {}) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['urls'], 'readonly');
                    const store = transaction.objectStore('urls');
                    const results = [];

                    let cursorRequest;
                    if (options.index && options.range) {
                        const index = store.index(options.index);
                        cursorRequest = index.openCursor(options.range, options.direction);
                    } else {
                        cursorRequest = store.openCursor(null, options.direction);
                    }

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            results.push(cursor.value);
                            if (!options.limit || results.length < options.limit) {
                                cursor.continue();
                            } else {
                                resolve(results);
                            }
                        } else {
                            resolve(results);
                        }
                    };

                    cursorRequest.onerror = (event) => reject(event);
                });
            });
        }

        // Delete a visit item
        deleteVisitItem(visitId) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['VisitItem'], 'readwrite');
                    const store = transaction.objectStore('VisitItem');

                    const request = store.delete(visitId);

                    request.onsuccess = () => resolve();
                    request.onerror = (event) => reject(event);
                });
            });
        }

        // Batch delete visit items
        deleteVisitItems(visitIds) {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(['VisitItem'], 'readwrite');
                    const store = transaction.objectStore('VisitItem');

                    let completed = 0;
                    let hasError = false;

                    visitIds.forEach(visitId => {
                        const request = store.delete(visitId);

                        request.onsuccess = () => {
                            completed++;
                            if (completed === visitIds.length && !hasError) {
                                resolve();
                            }
                        };

                        request.onerror = (event) => {
                            hasError = true;
                            reject(event);
                        };
                    });
                });
            });
        }

        /**
         * Drop cached history older than `beforeTime` from all three stores.
         *
         * This is what `load-range3` ("cache retention days") actually buys:
         * the tree pages already use it as the furthest day they will query,
         * so anything older than that boundary is unreachable and only costs
         * every page's startup snapshot. `VisitItem` is keyed by visitTime,
         * `urls` by lastVisitTime and `closed` by closeTime.
         *
         * `closed` rows with a non-positive close time are "still open" (-1)
         * or "url/title changed" (-2) markers that updateClosedTabsStatus()
         * has not flipped yet; their closeTime is 0, so they are deliberately
         * NOT swept here — they belong to the current session, not old cache.
         *
         * One transaction per store, resolves with the count removed.
         */
        purgeExpired(beforeTime) {
            const cutoff = Number(beforeTime);
            const specs = [
                { store: 'VisitItem', index: 'visitTime' },
                { store: 'urls', index: 'lastVisitTime' },
                { store: 'closed', index: 'closeTime' },
            ];
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(specs.map((s) => s.store), 'readwrite');
                    let removed = 0;
                    for (const spec of specs) {
                        const index = transaction.objectStore(spec.store).index(spec.index);
                        const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
                        request.onsuccess = (event) => {
                            const cursor = event.target.result;
                            if (!cursor) return;
                            // closeTime 0 means the row is not a closed page yet.
                            if (spec.store === 'closed' && !cursor.value.closeTime) {
                                cursor.continue();
                                return;
                            }
                            cursor.delete();
                            removed++;
                            cursor.continue();
                        };
                        request.onerror = (event) => reject(event);
                    }
                    transaction.oncomplete = () => resolve(removed);
                    transaction.onerror = (event) => reject(event);
                    transaction.onabort = (event) => reject(event);
                });
            });
        }

        // Update closed tabs status
        updateClosedTabsStatus() {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const time = (new Date()).getTime();
                    const transaction = db.transaction(['closed'], 'readwrite');
                    const store = transaction.objectStore('closed');
                    const index = store.index('close');
                    const range = IDBKeyRange.upperBound(-1);

                    // One cursor, not two: the second openCursor() existed only
                    // to hang .onerror on it, and it also risked the first
                    // transaction committing before the walk finished.
                    const cursorRequest = index.openCursor(range);

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            const value = cursor.value;
                            value.closeTime = time;
                            value.close = 0 - value.close;

                            const updateRequest = cursor.update(value);
                            updateRequest.onsuccess = () => {
                                debugLog('updateClosed() succeed ' + value.id);
                            };
                            updateRequest.onerror = () => {
                                debugLog('updateClosed() fail ' + value.id);
                            };

                            cursor.continue();
                        } else {
                            debugLog('updateClosed() done');
                            resolve();
                        }
                    };

                    cursorRequest.onerror = (event) => reject(event);
                });
            });
        }
    }

    // Create singleton instance
    const dbManager = new DBManager();

    // Export to global scope
    if (typeof window !== 'undefined') {
        window.dbManager = dbManager;
    }

    // Export to service worker global scope
    if (typeof self !== 'undefined') {
        self.dbManager = dbManager;
    }
})();
