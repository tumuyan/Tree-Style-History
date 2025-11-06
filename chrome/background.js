// Service Worker for Manifest V3
// Import scripts using dynamic import
importScripts('scripts/storage-adapter.js');
importScripts('scripts/moo.js');
importScripts('scripts/func.js');
importScripts('scripts/background.js');

// Message passing handlers for communication with UI pages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received:', request);
    
    if (request.action === 'getOpenedTabs') {
        sendResponse({ openedTabs: openedTabs });
        return true;
    }
    
    if (request.action === 'getRecentTabs') {
        sendResponse({ recentTabs: recentTabs });
        return true;
    }
    
    if (request.action === 'getDb') {
        // Cannot send IndexedDB connection directly
        // UI pages should open their own DB connection
        sendResponse({ error: 'Use getDbReady to check if DB is ready' });
        return true;
    }
    
    if (request.action === 'getDbReady') {
        sendResponse({ ready: db !== undefined });
        return true;
    }
    
    if (request.action === 'deleteDb') {
        deleteDb();
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'removeHistory') {
        removeHistory();
        sendResponse({ success: true });
        return true;
    }
    
    return false;
});

// Keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
    console.log('Port connected:', port.name);
});

console.log('Service worker loaded');
