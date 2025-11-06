// Message Adapter for MV2 to MV3 Migration
// Provides unified API for accessing background data
// Works with both background pages (MV2) and service workers (MV3)

(function() {
    'use strict';

    class MessageAdapter {
        constructor() {
            this.useServiceWorker = chrome.runtime.getManifest().manifest_version >= 3;
            this._bgCache = null;
        }

        // Get background page (MV2) or send message to service worker (MV3)
        getBackgroundData(key) {
            if (this.useServiceWorker) {
                // MV3: Use message passing
                return new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ 
                        action: 'getData', 
                        key: key 
                    }, response => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(response);
                        }
                    });
                });
            } else {
                // MV2: Direct access
                return new Promise((resolve, reject) => {
                    try {
                        const bg = chrome.extension.getBackgroundPage();
                        if (bg && bg[key] !== undefined) {
                            resolve(bg[key]);
                        } else {
                            reject(new Error(`Background data '${key}' not found`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        }

        // Get database instance
        getDB() {
            if (this.useServiceWorker) {
                // MV3: Use shared DB manager
                if (typeof dbManager !== 'undefined') {
                    return dbManager.getDB();
                } else {
                    return Promise.reject(new Error('DB Manager not available'));
                }
            } else {
                // MV2: Get from background
                return new Promise((resolve, reject) => {
                    try {
                        const bg = chrome.extension.getBackgroundPage();
                        if (bg && bg.db) {
                            resolve(bg.db);
                        } else if (bg && typeof bg.dbManager !== 'undefined') {
                            bg.dbManager.getDB().then(resolve).catch(reject);
                        } else {
                            reject(new Error('Database not available'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        }

        // Get opened tabs
        getOpenedTabs() {
            return this.getBackgroundData('openedTabs');
        }

        // Get recent tabs
        getRecentTabs() {
            return this.getBackgroundData('recentTabs');
        }

        // Get calendar storage
        getCalendarStorage() {
            return this.getBackgroundData('calendar_storage2');
        }

        // Call background function
        callBackgroundFunction(functionName, ...args) {
            if (this.useServiceWorker) {
                // MV3: Send message
                return new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: 'callFunction',
                        function: functionName,
                        args: args
                    }, response => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else if (response && response.error) {
                            reject(new Error(response.error));
                        } else {
                            resolve(response && response.result);
                        }
                    });
                });
            } else {
                // MV2: Direct call
                return new Promise((resolve, reject) => {
                    try {
                        const bg = chrome.extension.getBackgroundPage();
                        if (bg && typeof bg[functionName] === 'function') {
                            const result = bg[functionName](...args);
                            resolve(result);
                        } else {
                            reject(new Error(`Function '${functionName}' not found in background`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        }

        // Delete database
        deleteDB() {
            if (this.useServiceWorker) {
                if (typeof dbManager !== 'undefined') {
                    return dbManager.deleteDB();
                } else {
                    return Promise.reject(new Error('DB Manager not available'));
                }
            } else {
                return this.callBackgroundFunction('deleteDb');
            }
        }
    }

    // Create singleton instance
    const messageAdapter = new MessageAdapter();

    // Export to global scope
    if (typeof window !== 'undefined') {
        window.messageAdapter = messageAdapter;

        // Provide backward compatibility wrapper for getBackgroundPage
        window.getBackgroundPage = function() {
            console.warn('getBackgroundPage() is deprecated. Use messageAdapter instead.');
            if (!messageAdapter.useServiceWorker) {
                return chrome.extension.getBackgroundPage();
            } else {
                // Return proxy object that throws helpful errors
                return new Proxy({}, {
                    get(target, prop) {
                        throw new Error(`Cannot access background.${prop} in MV3. Use messageAdapter.getBackgroundData('${prop}') instead.`);
                    }
                });
            }
        };
    }
})();
