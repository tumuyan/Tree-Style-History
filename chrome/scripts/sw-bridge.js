// Service Worker Bridge for Manifest V3
// Provides a compatibility layer for accessing background service worker data

(function() {
    'use strict';
    
    const globalObj = typeof window !== 'undefined' ? window : self;
    
    // Cache for background data with expiry
    const backgroundCache = {
        openedTabs: null,
        recentTabs: null,
        dbReady: false,
        lastUpdate: 0,
        cacheDuration: 1000 // 1 second cache
    };
    
    // Message passing helper
    function sendMessageToSW(action) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: action }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('SW Bridge error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    }
    
    // Get opened tabs from service worker
    async function getOpenedTabs() {
        const now = Date.now();
        if (backgroundCache.openedTabs && (now - backgroundCache.lastUpdate < backgroundCache.cacheDuration)) {
            return backgroundCache.openedTabs;
        }
        
        try {
            const response = await sendMessageToSW('getOpenedTabs');
            backgroundCache.openedTabs = response.openedTabs || {};
            backgroundCache.lastUpdate = now;
            return backgroundCache.openedTabs;
        } catch (err) {
            console.error('Failed to get opened tabs:', err);
            return {};
        }
    }
    
    // Get recent tabs from service worker
    async function getRecentTabs() {
        const now = Date.now();
        if (backgroundCache.recentTabs && (now - backgroundCache.lastUpdate < backgroundCache.cacheDuration)) {
            return backgroundCache.recentTabs;
        }
        
        try {
            const response = await sendMessageToSW('getRecentTabs');
            backgroundCache.recentTabs = response.recentTabs || [];
            backgroundCache.lastUpdate = now;
            return backgroundCache.recentTabs;
        } catch (err) {
            console.error('Failed to get recent tabs:', err);
            return [];
        }
    }
    
    // Check if DB is ready
    async function isDbReady() {
        try {
            const response = await sendMessageToSW('getDbReady');
            return response.ready === true;
        } catch (err) {
            console.error('Failed to check DB ready:', err);
            return false;
        }
    }
    
    // Request background to delete DB
    async function requestDeleteDb() {
        try {
            await sendMessageToSW('deleteDb');
            return true;
        } catch (err) {
            console.error('Failed to delete DB:', err);
            return false;
        }
    }
    
    // Request background to remove history
    async function requestRemoveHistory() {
        try {
            await sendMessageToSW('removeHistory');
            return true;
        } catch (err) {
            console.error('Failed to remove history:', err);
            return false;
        }
    }
    
    // Open IndexedDB connection for UI pages
    // Each UI page should open its own DB connection
    function openDbConnection() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("testDB", 6);
            
            request.onerror = function(event) {
                console.error("Error opening DB", event);
                reject(event);
            };
            
            request.onsuccess = function(event) {
                console.log("DB opened successfully in UI page");
                resolve(event.target.result);
            };
            
            // This should not normally trigger as the SW should have created the schema
            request.onupgradeneeded = function(event) {
                console.warn("DB upgrade needed in UI page - this is unexpected");
                resolve(event.target.result);
            };
        });
    }
    
    // Export functions to global scope
    globalObj.swBridge = {
        getOpenedTabs,
        getRecentTabs,
        isDbReady,
        requestDeleteDb,
        requestRemoveHistory,
        openDbConnection
    };
    
    console.debug('SW Bridge initialized');
})();
