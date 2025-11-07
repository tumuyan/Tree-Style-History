// IndexedDB Manager for Tree Style History
// Provides unified database access for both background and UI pages
// Compatible with both MV2 background pages and MV3 service workers

(function() {
    'use strict';

    const DB_NAME = 'testDB';
    const DB_VERSION = 6;
    const DAY = 24 * 3600 * 1000;

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
                    console.log('Upgrading DB to version', DB_VERSION);
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
                            console.log('Created VisitItem store');
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
                            console.log('Created urls store');
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
                            console.log('Created closed store');
                        } catch (error) {
                            console.error('Error creating closed store:', error);
                        }
                    }
                };

                request.onsuccess = (event) => {
                    console.log('Success opening DB');
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
        }

        // Delete entire database
        deleteDB() {
            return new Promise((resolve, reject) => {
                if (this.db) {
                    this.db.close();
                    this.db = null;
                    this.isReady = false;
                }

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
                    console.log('Successfully deleted DB');
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

                    const request = store.add(visitItem);

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

        // Update closed tabs status
        updateClosedTabsStatus() {
            return this.getDB().then(db => {
                return new Promise((resolve, reject) => {
                    const time = (new Date()).getTime();
                    const transaction = db.transaction(['closed'], 'readwrite');
                    const store = transaction.objectStore('closed');
                    const index = store.index('close');
                    const range = IDBKeyRange.upperBound(-1);

                    const updates = [];

                    index.openCursor(range).onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            const value = cursor.value;
                            value.closeTime = time;
                            value.close = 0 - value.close;

                            const updateRequest = cursor.update(value);
                            updateRequest.onsuccess = () => {
                                console.log('updateClosed() succeed ' + value.id);
                            };
                            updateRequest.onerror = () => {
                                console.log('updateClosed() fail ' + value.id);
                            };

                            cursor.continue();
                        } else {
                            console.log('updateClosed() done');
                            resolve();
                        }
                    };

                    index.openCursor(range).onerror = (event) => reject(event);
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

    // Also export for module systems (future-proofing)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = dbManager;
    }

    // Export to service worker global scope
    if (typeof self !== 'undefined') {
        self.dbManager = dbManager;
    }
})();
