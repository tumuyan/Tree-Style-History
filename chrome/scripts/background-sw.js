// Service Worker for Tree Style History (Manifest V3)
// This replaces background.html/background.js for MV3 compatibility

// Import modules
importScripts('storage-adapter.js');
importScripts('background-utils.js');
importScripts('db-manager.js');

// Startup timing
const _tSW = performance.now();
// Declared here rather than where they are assigned: `initializeExistingTabs()`
// reads all three, and a `const` further down the file is in the temporal dead
// zone until execution reaches it.
var _tSW_init, _tSW_db, _tSW_load;  // timing markers for startup summary

// Idempotent flag: prevent double initialization from onStorageReady + onInstalled/onStartup
var _storageInitialized = false;

// Set global vars
var openedTabs = {};
var recentTabs = [];

// Session data (will be persisted to storage due to SW lifecycle)
var oid;
DAY = 24 * 3600 * 1000; // from background-utils.js
var date = new Date();
date.setHours(23); date.setMinutes(59); date.setSeconds(59); date.setMilliseconds(999);

var calendar_str;
var calendar = {};
var calendar_r = {};

var urls_wait_load = new Array();

// Tab tracking data
var openerJson = {};
var tabUrlJson = {};
var tabUrl0Json = {};
var urlIdJson = {};
var idUrlJson = {};

// --- Session state -------------------------------------------------------
//
// Everything just declared lives in module scope, so the browser throws it
// away every time it recycles the service worker (~30s idle) — and a wake-up
// re-runs this file, so the maps come back empty even when no tab event was
// missed.
//
// That is not a cosmetic loss: `urlIdJson`/`idUrlJson` are the only record of
// which visitId belongs to the page a link was opened from, and
// `add_tab_history()` needs exactly that to name the new page's parent. With
// them gone every link clicked after a recycle is stored as a root node — the
// tree this extension exists to build silently flattens.
//
// `openedTabs`/`recentTabs` are saved for the same reason:
// `initializeExistingTabs()` can only rebuild them from the tabs open right
// now, which loses the activation order the popup's "recently viewed" list is
// sorted by.
//
// Written to chrome.storage.session: in memory, cleared when the browser
// exits, and — unlike chrome.storage.local — no disk write per update.

const SESSION_STATE_KEY = 'tab-state';
// Bumped whenever the shape below changes; an old snapshot is then ignored
// rather than half-restored.
const SESSION_STATE_VERSION = 1;
const SESSION_SAVE_DELAY_MS = 1000;

// The two tab fields on their own, for the popup.
//
// The popup used to fetch them with chrome.runtime.sendMessage, and a message
// wakes this worker — which then runs the whole startup crawl again, seconds of
// work whose only visible result is a list of tabs. chrome.storage.session is
// read out of the browser process, so the popup can have the list without
// paying for a wake.
//
// A separate key rather than a read of `tab-state`: that snapshot carries up to
// 2 * SESSION_ID_LIMIT URL->visitId pairs, and deserialising it on every popup
// open would cost more than the round trip it saves.
const TAB_LIST_KEY = 'tab-list';
const TAB_LIST_VERSION = 1;
// urlIdJson/idUrlJson gain an entry per visited URL and nothing prunes them,
// so the snapshot has to be capped before it is written: session storage
// allowed 1MB until Chrome 112 (10MB since), and a long URL is ~1KB on its
// own. 1000 remembered URLs is far more than a link chain needs.

const SESSION_ID_LIMIT = 1000;

/** The part of the snapshot the popup renders, without the visit-id maps. */
function tabListSnapshot() {
    return {
        v: TAB_LIST_VERSION,
        openedTabs: openedTabs,
        recentTabs: recentTabs,
    };
}

/**
 * Drop the oldest url -> visitId pairs once the cap is passed.
 *
 * `Object.keys()` walks non-integer keys in insertion order, so the front of
 * `urlIdJson` is the oldest entry and this is FIFO.
 */
function trimVisitIdMaps() {
    const urls = Object.keys(urlIdJson);
    const excess = urls.length - SESSION_ID_LIMIT;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i++) {
        const visitId = urlIdJson[urls[i]];
        delete urlIdJson[urls[i]];
        if (visitId !== undefined) delete idUrlJson[visitId.toString()];
    }
}

function snapshotSessionState() {
    return {
        v: SESSION_STATE_VERSION,
        openerJson: openerJson,
        tabUrlJson: tabUrlJson,
        tabUrl0Json: tabUrl0Json,
        urlIdJson: urlIdJson,
        idUrlJson: idUrlJson,
        openedTabs: openedTabs,
        recentTabs: recentTabs,
    };
}

/** chrome.storage.session, or null on a browser too old to have it. */
function sessionArea() {
    return (chrome.storage && chrome.storage.session) ? chrome.storage.session : null;
}

var _sessionSaveTimer = null;

/**
 * Coalesce the flood of tab events into one write per second.
 *
 * A pending timer dies with the worker, so this is best-effort by nature: the
 * worst case is losing the last second of tab switching, which is exactly
 * what an unpersisted restart already cost.
 */
function scheduleSessionSave() {
    if (_sessionSaveTimer !== null) return;
    _sessionSaveTimer = setTimeout(function () {
        _sessionSaveTimer = null;
        saveSessionState();
    }, SESSION_SAVE_DELAY_MS);
}

function saveSessionState() {
    const area = sessionArea();
    if (!area) return Promise.resolve();

    // `area.set()` is called inside a `then` rather than passed to
    // Promise.resolve(): a value that cannot be structured-cloned makes
    // Chrome throw *synchronously*, i.e. before any .catch() is attached.
    const write = function (snapshot) {
        return Promise.resolve().then(function () {
            // One call, so the two copies can never disagree: session.set() is
            // atomic and the tab list is re-read from module scope either way,
            // including on the retry below, where it is the part that survives.
            return area.set({
                [SESSION_STATE_KEY]: snapshot,
                [TAB_LIST_KEY]: tabListSnapshot(),
            });
        });
    };

    const full = snapshotSessionState();
    return write(full).catch(function (error) {
        // session.set() is atomic: one oversized key fails the whole write,
        // which would also lose the visit-id maps — the one part nothing can
        // rebuild. Retry without the tab lists instead; they are the only
        // part initializeExistingTabs() can reconstruct from live tabs.
        console.warn('SW: session snapshot rejected, retrying without tab lists', error);
        const trimmed = Object.assign({}, full, { openedTabs: {}, recentTabs: [] });
        return write(trimmed).catch(function (again) {
            console.warn('SW: could not persist session state', again);
        });
    });
}

function restoreSessionState() {
    const area = sessionArea();
    if (!area) return Promise.resolve(false);
    return Promise.resolve().then(function () {
        return area.get([SESSION_STATE_KEY, TAB_LIST_KEY]);
    }).then(function (result) {
        // get() always resolves with an object, so `|| {}` is not a real branch:
        // it only keeps a bare read from throwing into the catch below, which
        // would report a restore failure and skip the tab-list recovery — the
        // part that survives a stale full snapshot.
        const {
            [SESSION_STATE_KEY]: saved,
            [TAB_LIST_KEY]: tabs,
        } = result || {};
        const restored = Boolean(saved) && saved.v === SESSION_STATE_VERSION;

        if (restored) {
            openerJson = saved.openerJson || {};
            tabUrlJson = saved.tabUrlJson || {};
            tabUrl0Json = saved.tabUrl0Json || {};
            urlIdJson = saved.urlIdJson || {};
            idUrlJson = saved.idUrlJson || {};
            openedTabs = saved.openedTabs || {};
            recentTabs = Array.isArray(saved.recentTabs) ? saved.recentTabs : [];
        }

        // saveSessionState() drops the tab lists from the full snapshot when it
        // does not fit. The popup-sized copy is written in the same call, so it
        // still holds them — and activation order is the one thing
        // initializeExistingTabs() cannot reconstruct from live tabs.
        //
        // Applied after the version check above rather than inside it: the tab
        // list carries its own version, so bumping SESSION_STATE_VERSION must
        // not discard it. Its position is what makes that work — it has to
        // overwrite what the block above may have left empty, without being
        // overwritten in turn.
        if (tabs && tabs.v === TAB_LIST_VERSION) {
            if (Object.keys(openedTabs).length === 0 && tabs.openedTabs) {
                openedTabs = tabs.openedTabs;
            }
            if (recentTabs.length === 0 && Array.isArray(tabs.recentTabs)) {
                recentTabs = tabs.recentTabs;
            }
        }

        return restored;
    }).catch(function (error) {
        console.warn('SW: could not restore session state', error);
        return false;
    });
}

console.log("Service Worker loading... (" + (performance.now() - _tSW).toFixed(1) + "ms)");

// Initialize on install
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

// Activate and take control
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(clients.claim());
});

// Favicon cache for third-party favicon services
// Reduces 429 errors by caching favicon responses in the Cache API
const FAVICON_CACHE = 'favicon-cache';
const FAVICON_SHARED_KEY_PREFIX = 'https://favicon-cache.internal/shared/';
const FAVICON_SERVICE_PATTERNS = [
    'icons.duckduckgo.com',
    'www.google.com/s2/favicons',
    'favicon.im/',
    'ico.faviconkit.net/',
    'faviconsnap.com/api/favicon'
];

// Share favicon cache between services (default: enabled)
// Updated from localStorage when storage is ready
var _shareFaviconCache = true;

function isFaviconRequest(url) {
    if (typeof url !== 'string') return false;
    for (var i = 0; i < FAVICON_SERVICE_PATTERNS.length; i++) {
        if (url.indexOf(FAVICON_SERVICE_PATTERNS[i]) !== -1) return true;
    }
    return false;
}

// Extract hostname from favicon service URL for shared cache key
function extractHostnameFromFaviconUrl(url) {
    try {
        var u = new URL(url);
        // DuckDuckGo: icons.duckduckgo.com/ip3/{hostname}.ico
        if (u.hostname === 'icons.duckduckgo.com') {
            var m = url.match(/\/ip3\/([^\/?]+)\.ico/);
            if (m) return m[1];
        }
        // Favicon.im: favicon.im/{hostname}
        if (u.hostname === 'favicon.im') {
            m = url.match(/favicon\.im\/([^\/?]+)/);
            if (m) return m[1];
        }
        // FaviconKit: ico.faviconkit.net/favicon/{hostname}
        if (u.hostname === 'ico.faviconkit.net') {
            m = url.match(/\/favicon\/([^\/?]+)/);
            if (m) return m[1];
        }
        // FaviconSnap: faviconsnap.com/api/favicon?url=...
        if (u.hostname === 'faviconsnap.com') {
            var du = u.searchParams.get('url');
            if (du) return new URL(decodeURIComponent(du)).hostname;
        }
        // Google: www.google.com/s2/favicons?domain_url=...
        if (u.hostname === 'www.google.com') {
            du = u.searchParams.get('domain_url');
            if (du) return new URL(decodeURIComponent(du)).hostname;
        }
    } catch {}
    return null;
}

// === Negative Cache for failed API+domain combinations ===
// Stores URLs that have previously failed (404, etc.) to avoid 
// repeating network requests within a configurable time window.
const NEGATIVE_CACHE_TTL = 3600000; // 1 hour

function getNegativeCache() {
    try {
        return JSON.parse(localStorage['favicon-negative-cache'] || '{}');
    } catch {
        return {};
    }
}

function setNegativeCache(cache) {
    try {
        localStorage['favicon-negative-cache'] = JSON.stringify(cache);
    } catch {}
}

function isNegativeCached(url) {
    if (!url) return false;
    var cache = getNegativeCache();
    var ts = cache[url];
    if (!ts) return false;
    // Expired entry -> clean up and allow retry
    if (Date.now() - ts > NEGATIVE_CACHE_TTL) {
        delete cache[url];
        setNegativeCache(cache);
        return false;
    }
    return true;
}

function addNegativeCache(url) {
    if (!url) return;
    var cache = getNegativeCache();
    // Periodically clean expired entries (~every 20 entries)
    var keys = Object.keys(cache);
    if (keys.length >= 20) {
        var now = Date.now();
        keys.forEach(function(key) {
            if (now - cache[key] > NEGATIVE_CACHE_TTL) {
                delete cache[key];
            }
        });
    }
    cache[url] = Date.now();
    setNegativeCache(cache);
}

// Best-effort cache write. cache.put() is deliberately not awaited (writing must
// not delay the response), so an unhandled rejection -- e.g. QuotaExceededError --
// would surface as "Uncaught (in promise)". Losing a cache entry is harmless.
function cachePutSafe(cache, request, response) {
    try {
        var p = cache.put(request, response);
        if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch {}
}

// Try the configured fallback service for the same hostname.
// Returns a Response, or null when there is nothing usable (no fallback
// configured, negative cached, or the fallback itself failed).
async function fetchFaviconFallback(request, cache) {
    var hostname = extractHostnameFromFaviconUrl(request.url);
    if (!hostname) return null;

    var fallbackService = localStorage['favicon-service-fallback'] || '';
    if (!fallbackService) return null;

    var fallbackUrl = getFaviconUrl('https://' + hostname, { service: fallbackService });
    if (!fallbackUrl || typeof fallbackUrl !== 'string' || fallbackUrl.indexOf('http') !== 0 || !isFaviconRequest(fallbackUrl)) {
        return null;
    }
    if (isNegativeCached(fallbackUrl)) {
        console.info('SW: fallback also negative cached for', hostname);
        return null;
    }
    try {
        var fallbackResponse = await fetch(fallbackUrl);
        if (fallbackResponse && (fallbackResponse.ok || fallbackResponse.type === 'opaque')) {
            cachePutSafe(cache, new Request(fallbackUrl), fallbackResponse.clone());
            if (_shareFaviconCache) {
                cachePutSafe(cache, new Request(FAVICON_SHARED_KEY_PREFIX + hostname), fallbackResponse.clone());
            }
            return fallbackResponse;
        }
        // Fallback answered, but with a failure status -> negative cache it
        addNegativeCache(fallbackUrl);
    } catch (e) {
        // Offline / DNS / CORS / service outage: routine for favicon services
        addNegativeCache(fallbackUrl);
        console.debug('SW: fallback favicon fetch failed for', hostname, e && e.message);
    }
    return null;
}

async function handleFaviconRequest(request) {
    var cache = await caches.open(FAVICON_CACHE);

    // Try shared cache first (same hostname cached from any service)
    if (_shareFaviconCache) {
        var sharedHostname = extractHostnameFromFaviconUrl(request.url);
        if (sharedHostname) {
            var sharedRequest = new Request(FAVICON_SHARED_KEY_PREFIX + sharedHostname);
            var sharedMatch = await cache.match(sharedRequest);
            if (sharedMatch) return sharedMatch;
        }
    }

    // Fall back to exact URL match
    var exactMatch = await cache.match(request);
    if (exactMatch) return exactMatch;

    // Check negative cache: skip network if this URL recently failed
    var response = null;
    if (!isNegativeCached(request.url)) {
        try {
            response = await fetch(request);
        } catch (e) {
            // Network-level failure (offline, DNS, blocked, service outage).
            // Expected and frequent for third-party favicon services -> debug level only.
            addNegativeCache(request.url);
            console.debug('SW: favicon fetch failed for', request.url, e && e.message);
        }
    }

    if (response && (response.ok || response.type === 'opaque')) {
        cachePutSafe(cache, request, response.clone());

        // Shared cache: ONLY for confirmed successful responses (response.ok === true)
        // Opaque responses (status 0, e.g. 404 from Google) cannot be verified,
        // caching them in shared would poison other services' fallback requests.
        if (_shareFaviconCache && response.ok) {
            var okHostname = extractHostnameFromFaviconUrl(request.url);
            if (okHostname) {
                cachePutSafe(cache, new Request(FAVICON_SHARED_KEY_PREFIX + okHostname), response.clone());
            }
        }
        return response;
    }

    // Primary service returned a failure status (or was skipped) -> negative cache
    // it and try the configured fallback service.
    if (response) addNegativeCache(request.url);
    var fallback = await fetchFaviconFallback(request, cache);
    if (fallback) return fallback;

    // Nothing worked. Returning null here made Chrome log
    // "Failed to convert value to 'Response'." -- resolve to a network error
    // instead, which simply fires the page's img error handler (the frontend
    // degradation path) without touching the SW console.
    return response || Response.error();
}

self.addEventListener('fetch', (event) => {
    if (!isFaviconRequest(event.request.url)) return;
    event.respondWith(
        handleFaviconRequest(event.request).catch(function (e) {
            // Last-resort guard: a rejected respondWith() promise makes Chrome log
            // "The FetchEvent for ... resulted in a network error response:
            // the promise was rejected." -- which cannot be caught anywhere else.
            console.debug('SW: favicon handler failed for', event.request.url, e && e.message);
            return Response.error();
        })
    );
});

// Initialize storage and DB when service worker starts
onStorageReady(function () {
    initializeStorageState();
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('onInstalled event');
    onStorageReady(function () {
        initializeStorageState();
    });
});

chrome.runtime.onStartup.addListener(() => {
    console.log('onStartup event');
    onStorageReady(function () {
        initializeStorageState();
    });
});

function initializeStorageState() {
    // Idempotent: prevent double initialization from overlapping event sources
    if (_storageInitialized) return;
    _storageInitialized = true;

    console.log('Initializing storage state... (' + (performance.now() - _tSW).toFixed(1) + 'ms)');
    _tSW_init = performance.now();
    
    // Read favicon cache sharing preference
    _shareFaviconCache = localStorage['share-favicon-cache'] !== 'no';
    
    oid = localStorage['oid'];
    if (oid == undefined) {
        oid = 1;
    } else {
        oid++;
    }
    localStorage['oid'] = oid;

    calendar_str = localStorage['calendar-storage'];
    calendar = {};
    calendar_r = {};
    if (calendar_str) {
        try {
            calendar = JSON.parse(calendar_str);
        } catch (error) {
            console.warn('Failed to parse calendar-storage', error);
            calendar = {};
        }
    }

    defaultConfig(false);

    // Initialize Most Visited (once per session)
    mostVisitedInit();
    
    // Periodic refresh of the most-visited cache.
    //
    // The period costs far more than it looks. Every alarm wakes the service
    // worker, and a worker that wakes runs this entire initialisation again —
    // including the history crawl in loadDate() — because `_storageInitialized`
    // is a module-level variable and starts false in every new worker. At three
    // minutes that meant dozens of full re-initialisations an hour. "Most
    // visited" changes slowly, so half an hour is plenty.
    chrome.alarms.create('mostVisited', { periodInMinutes: 30 });
    
    // Initialize DB
    if (typeof dbManager !== 'undefined') {
        dbManager.init().then(() => {
            console.log('DB ready in service worker (' + (performance.now() - _tSW).toFixed(1) + 'ms)');
            _tSW_db = performance.now();
            dbManager.updateClosedTabsStatus();
            loadDate(date.getTime(), 0).catch(error => {
                console.error('loadDate error:', error);
            });
        }).catch(error => {
            console.error('Failed to initialize DB:', error);
        });
    } else {
        console.error('dbManager is not defined!');
    }
    
    // Initialize context menu
    initContextMenu();
    
    // Initialize existing tabs. Restored first, because the visit-id maps
    // have no other source and the live-tab query can only rebuild the two
    // tab lists.
    restoreSessionState().then(function (restored) {
        console.log('Session state: ' + (restored ? 'restored' : 'cold start'));
        initializeExistingTabs();
    }).catch(function (error) {
        // Only reachable from initializeExistingTabs(): restoreSessionState()
        // handles its own failures. Without this a throw inside the pruning
        // loop below would vanish as an unhandled rejection.
        console.error('SW: failed to initialize existing tabs', error);
    });
}

// Initialize tracking for existing tabs when service worker starts
function initializeExistingTabs() {
    chrome.tabs.query({}, function(tabs) {
        console.log('Initializing ' + tabs.length + ' existing tabs (' + (performance.now() - _tSW).toFixed(1) + 'ms)');

        const live = {};
        for (let tab of tabs) {
            live[tab.id] = true;
            openedTabs[tab.id] = tab;
            // Restored from session storage, so the id is usually already
            // there; unshifting twice would show the tab twice.
            if (tab.active && recentTabs.indexOf(tab.id) < 0) {
                recentTabs.unshift(tab.id);
            }
        }

        // Everything keyed by tab id is dropped for tabs that are gone: they
        // were closed while the worker was down, so onRemoved never reached
        // us and nothing else would ever clean them up.
        for (const id of Object.keys(openedTabs)) {
            if (live[id]) continue;
            delete openedTabs[id];
            delete tabUrlJson[id];
            delete tabUrl0Json[id];
            delete openerJson[id];
        }
        recentTabs = recentTabs.filter(function (id) { return live[id]; });

        console.log('Opened tabs count:', Object.keys(openedTabs).length);
        var dbMs = (_tSW_db !== undefined) ? (_tSW_db - _tSW).toFixed(1) + 'ms' : '(pending)';
        console.log('[SW Startup] sync=' + (_tSW_load - _tSW).toFixed(1) +
            'ms | init=' + (_tSW_init - _tSW).toFixed(1) +
            'ms | db=' + dbMs +
            ' | tabs=' + (performance.now() - _tSW).toFixed(1) +
            'ms  (total=' + (performance.now() - _tSW).toFixed(1) + 'ms)');
    });
}

// Handle alarms (replaces setInterval)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'mostVisited') {
        mostVisitedInit();
    }
});

// Opened tab
function openedTab(tab) {
    openedTabs[tab.id] = tab;
    addCloseRecord(tab.id, tab.url, tab.title, 0, -1);
    scheduleSessionSave();
}

// Closed tab
function closedTab(id) {
    if (openedTabs[id] !== undefined) {
        console.debug('close ' + id + ' ' + openedTabs[id].url);
        addCloseRecord(id, openedTabs[id].url, openedTabs[id].title, (new Date()).getTime(), 0);
    }

    // The per-tab maps are keyed by tab id and nothing else ever removed
    // entries, so they grew for as long as the browser stayed open.
    delete openedTabs[id];
    delete tabUrlJson[id];
    delete tabUrl0Json[id];
    delete openerJson[id];

    var i = recentTabs.indexOf(id);
    if (i >= 0) {
        recentTabs.splice(i, 1);
    }
    scheduleSessionSave();
}

// Add close record
//
// `oid` is the session ordinal, bumped once per service worker start in
// initializeStorageState(). Both fields must name the SAME session: the record
// is filed under `oid` in the closed-tab tree (closed.js groups by it), so a
// key that says "session 5" while the grouping field says 4 puts the record in
// a group it does not belong to. `id` is `<oid>_<tid>` and `oid` is the number
// that prefixes it.
function addCloseRecord(tid, url, title, time, close) {
    if ((/^(http|https)\:\/\/(.*)/).test(url) && url != title && title != '') {
        dbManager.putClosedTab({
            id: oid + '_' + tid,
            oid: oid,
            tid: tid,
            url: url,
            title: title,
            closeTime: time,
            close: close
        }).catch(error => {
            console.error('Failed to save closed tab:', error);
        });
    }
}

// Updated tab
function updatedTab(tab) {
    if (tab.status == 'complete') {
        if (openedTabs[tab.id] !== undefined) {
            if (openedTabs[tab.id].url != tab.url || openedTabs[tab.id].title != tab.title) {
                addCloseRecord(tab.id, tab.url, tab.title, 0, -2);
            }
            openedTabs[tab.id].title = tab.title;
            openedTabs[tab.id].url = tab.url;
            scheduleSessionSave();
        }
    }
}

// Most visited init
var mostVisitedInit = function () {
    var mv = [];
    var infmv = 45;
    var r = 0;

    chrome.history.search({ 
        text: '', 
        maxResults: 0, 
        startTime: (new Date()).getTime() - (28 * 24 * 3600 * 1000), 
        endTime: (new Date()).getTime() 
    }, function (hi) {
        if (hi.length > 0) {
            hi.sort(function (a, b) { return b.visitCount - a.visitCount });

            for (let i = 0; i < 99; i++) {
                if (r == infmv) { break; }

                if (hi[i] !== undefined) {
                    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(hi[i].title) == false && 
                        INTERNAL_URL.test(hi[i].url) == false) {

                        // The time-of-day a page was last visited was computed
                        // here and dropped on the floor — mostVisited() in
                        // popup-core.js builds its items without it.
                        var title = hi[i].title;
                        var url = hi[i].url;
                        var furl = getFaviconUrl(hi[i].url);

                        if (title == '') {
                            title = url;
                        }

                        mv.push({ 
                            url: url, 
                            favicon: furl, 
                            title: title.replace(/\"/g, '&#34;'), 
                            visitCount: hi[i].visitCount 
                        });

                        r++;
                    }
                }
            }

            localStorage['mv-cache'] = JSON.stringify(mv);
        } else {
            localStorage['mv-cache'] = 'false';
        }
    });
};

// Listeners
chrome.commands.onCommand.addListener(function (command) {
    console.log('Command:', command);
    if (command == "open_history2") {
        chrome.tabs.create({ url: "history2.html" });
    } else if (command == "open_history1") {
        chrome.tabs.create({ url: "history.html" });
    } else if (command == "open_closed") {
        chrome.tabs.create({ url: "closed.html" });
    } else if (command == "open_bookmark") {
        chrome.tabs.create({ url: "bookmark.html" });
    }
});

chrome.tabs.onRemoved.addListener(function (id) { closedTab(id) });

chrome.tabs.onCreated.addListener(function (tab) {
    openedTab(tab);

    if (tab.openerTabId != undefined && 
        (/^(ftp|ftps|file|chrome|edge|chrome-extension)\:\/\/(.*)/).test(tab.url) == false) {
        if (tab.openerTabId > 0 && tab.id != tab.openerTabId) {
            if (tabUrlJson[tab.openerTabId.toString()] != undefined) {
                openerJson[tab.id.toString()] = tabUrlJson[tab.openerTabId.toString()];
                console.debug("chrome.tabs.onCreated " + tab.openerTabId + " -> " + tab.id + "; " + 
                    openerJson[tab.id.toString()] + " -> " + tab.url + ";");
                scheduleSessionSave();
            }
        }
    }
});

chrome.tabs.onUpdated.addListener(function (id, info, tab) {
    if (tabUrlJson[id.toString()] != tab.url) {
        if (tabUrlJson[id.toString()] != undefined)
            tabUrl0Json[id.toString()] = tabUrlJson[id.toString()];
        tabUrlJson[id.toString()] = tab.url;
        scheduleSessionSave();
    }

    if (info.status == "complete") {
        console.debug("chrome.tabs.onUpdated v " + tab.openerTabId + " -> " + tab.id + "; " + 
            openerJson[tab.id.toString()] + " -> " + tab.url + "; title=" + tab.title);
        visitTab(tab).catch(error => {
            console.error("visitTab error:", error);
        });
    }

    updatedTab(tab);
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
    var i = recentTabs.indexOf(activeInfo.tabId);
    if (i >= 0) {
        recentTabs.splice(i, 1);
    }
    recentTabs.unshift(activeInfo.tabId);
    scheduleSessionSave();
});

// Context menu handlers
function handleContextMenuClick(info) {
    let url = info.linkUrl;
    if (url != undefined) {
        chrome.tabs.create({ url: 'history.html?' + url });
        return;
    }
    url = info.pageUrl;
    if (url != undefined) {
        chrome.tabs.create({ url: 'history.html?' + url });
    }
}

function initContextMenu() {
    if (!chrome.contextMenus) {
        console.warn('Context menus API is not available.');
        return;
    }

    chrome.contextMenus.removeAll(() => {
        // Remove listener first to avoid duplicates
        chrome.contextMenus.onClicked.removeListener(handleContextMenuClick);

        const options = {
            type: 'normal',
            id: 'tree_style_history_' + getVersion(),
            title: returnLang('searchSite'),
            contexts: ["link", "page"],
            visible: true,
        };

        if (localStorage['use-contextmenu'] === 'yes') {
            chrome.contextMenus.create(options, () => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    console.warn('Failed to create context menu:', chrome.runtime.lastError);
                } else {
                    console.log('Context menu ready:', options.id);
                    chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
                }
            });
        }
    });
}

// Listen for context menu config changes
if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, 'use-contextmenu')) {
            return;
        }

        const reinitMenu = () => initContextMenu();
        if (typeof storageAdapter !== 'undefined' && storageAdapter && 
            typeof storageAdapter.ready === 'function') {
            storageAdapter.ready().then(reinitMenu);
        } else {
            reinitMenu();
        }
    });
}

// Load date function — refactored from recursive callback to async/await
async function loadDate(date, dateId) {
    if (dateId > localStorage['load-range']) {
        console.debug("loadDate done. dateId = " + dateId + ">" + localStorage['load-range']);
        localStorage['calendar-storage'] = JSON.stringify(calendar_r);
        chrome.action.setBadgeText({ text: "Url" });
        loadHistory();
        return;
    }

    chrome.action.setBadgeText({ text: "D" + (localStorage['load-range'] - dateId) });

    let dday = "d" + (date + DAY).toString();
    let qday = "d" + date;

    if (dateId > 1) {
        calendar[dday] = true;
    }

    calendar_r[dday] = calendar[dday];

    if (calendar[qday]) {
        console.debug("skip dday=" + dday + ":" + calendar[dday] + " qday=" + qday + ":" + calendar[qday]);
        await add_urls([], date, dateId);
    } else {
        console.debug("load dday=" + dday + ":" + calendar[dday] + " qday=" + qday + ":" + calendar[qday]);
        let obj = { text: '', maxResults: 0, startTime: date - (24 * 3600 * 1000), endTime: date };
        
        try {
            let hi = await new Promise(resolve => chrome.history.search(obj, resolve));
            if (hi.length > 0) {
                hi.sort(function (a, b) { return b.visitCount - a.visitCount });
                save_calendar_storage2(obj, hi.length, false);
            }
            await add_urls(hi, date, dateId);
        } catch (error) {
            console.error("loadDate search error:", error);
            await add_urls([], date, dateId);
        }
    }
}

// Add URLs function — refactored from recursive .then() to async/await + loop
async function add_urls(urls, date_ms, dateId) {
    let h_len = urls.length;

    if (h_len > 0) {
        const batch = [];
        for (let i = 0; i < h_len; i++) {
            if (urls[i] != undefined && 
                (/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(urls[i].title) == false && 
                (/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(urls[i].url) == false) {
                
                var title = urls[i].title;
                var url = urls[i].url;

                if (title == '') {
                    title = url;
                }

                batch.push({
                    id: urls[i].id,
                    url: url,
                    lastVisitTime: urls[i].lastVisitTime,
                    visitCount: urls[i].visitCount,
                    title: title
                });
            }
        }
        if (batch.length > 0) {
            await writeBatch(batch,
                dbManager.putURLs.bind(dbManager),
                dbManager.putURL.bind(dbManager), 'urls');
        }
        console.debug("dateId=" + dateId + " loadDate(" + (new Date(date_ms)).toString() + ") done");
    } else {
        console.debug("dateId=" + dateId + " loadDate(" + (new Date(date_ms)).toString() + ") no data");
    }

    await loadDate(date_ms - DAY, dateId + 1);
}

// --- Crawl batching -------------------------------------------------------
//
// The startup crawl writes tens of thousands of rows. One transaction per row
// made it slow enough that the service worker was usually recycled before it
// finished — and a restart begins the crawl again from scratch, so it could
// never get through a large history at all. Rows now accumulate and go in a
// single transaction per ~1000.
const VISIT_FLUSH_SIZE = 1000;
var visitBatch = [];
var urlBatch = [];

/**
 * Write `batch` with `writeAll`, falling back to `writeOne` per record.
 *
 * A single bad record aborts the whole transaction, so a plain batch would let
 * it take its siblings down with it — the per-row loop never did that.
 */
async function writeBatch(batch, writeAll, writeOne, label) {
    try {
        await writeAll(batch);
    } catch (error) {
        console.warn(label + ': batch write failed, retrying one by one', error);
        for (const record of batch) {
            try {
                await writeOne(record);
            } catch (e) {
                console.error(label + ': giving up on a record', e);
            }
        }
    }
}

/** Commit everything accumulated so far. Safe to call when both are empty. */
async function flushCrawlBatch() {
    const visits = visitBatch;
    const urls = urlBatch;
    visitBatch = [];
    urlBatch = [];

    if (visits.length > 0) {
        await writeBatch(visits,
            dbManager.putVisitItems.bind(dbManager),
            dbManager.putVisitItem.bind(dbManager), 'visitItems');
    }
    if (urls.length > 0) {
        await writeBatch(urls,
            dbManager.putURLs.bind(dbManager),
            dbManager.putURL.bind(dbManager), 'urls');
    }
}

// The badge was being updated once per URL — thousands of times per crawl.
// Throttle it, but let the caller force the final write through so the badge
// always ends up cleared.
const BADGE_INTERVAL_MS = 500;
var _badgeAt = 0;
var _badgeText = null;

function setBadge(text, force) {
    const now = Date.now();
    if (!force && text === _badgeText && now - _badgeAt < BADGE_INTERVAL_MS) return;
    _badgeAt = now;
    _badgeText = text;
    chrome.action.setBadgeText({ text: text });
}

// Load history function
function loadHistory() {
    dbManager.queryURLs({
        index: 'lastVisitTime',
        range: IDBKeyRange.lowerBound((new Date()).getTime() - DAY * localStorage["load-range"]),
        direction: 'next'
    }).then(urls => {
        urls_wait_load = urls.filter(url => {
            return !url.loadto || url.loadto < url.lastVisitTime;
        });
        processVisits();
    }).catch(error => {
        console.error('loadHistory() Error:', error);
    });
}

// How many URLs to ask chrome.history.getVisits() about at once. Six keeps
// the crawl moving without tripping the history API's own throttling.
const VISIT_CONCURRENCY = 6;
const CRAWL_CURSOR_KEY = 'crawl-cursor';
// How often the crawl is flushed and its position persisted. ~500 URLs keeps
// the worst case for a recycled worker at half a chunk of wasted work while
// still committing one transaction per several hundred rows.
const CRAWL_CHECKPOINT_URLS = 500;
// A cursor older than this describes a URL list from a different sitting; new
// visits have changed it, so start over rather than trust the position.
const CRAWL_CURSOR_TTL = 6 * 3600 * 1000;

// Process visits - async/await refactored from getVisits/add_history/update_urls
//
// The crawl walks every URL in the configured range and asks the history API
// for its visits. One `await` per URL meant tens of thousands of sequential
// round trips — slow enough that the worker was usually recycled before it
// finished, and a restart began again from zero, so a large history could
// never be crawled at all. It now goes in chunks, and the position is
// persisted so a restart picks up where it stopped.
async function processVisits() {
    const start = await restoreCrawlCursor();
    console.debug("getVisits() start=" + start + "/" + urls_wait_load.length);

    let sinceCheckpoint = 0;
    for (let urls_p = start; urls_p < urls_wait_load.length; urls_p += VISIT_CONCURRENCY) {
        setBadge((urls_wait_load.length - urls_p).toString());

        const chunk = urls_wait_load.slice(urls_p, urls_p + VISIT_CONCURRENCY);
        // allSettled, not all: a URL that throws must not abandon the URLs
        // queued next to it.
        const results = await Promise.allSettled(chunk.map(crawlUrlVisits));
        for (const r of results) {
            if (r.status === 'rejected') console.error("crawlUrlVisits() failed", r.reason);
        }

        sinceCheckpoint += chunk.length;
        // Checkpointed by URL count rather than by batch size: crawlUrlVisits()
        // flushes on its own once a batch fills, so waiting for a full batch
        // here would almost never fire and the cursor would never move.
        //
        // Flush first, persist second. A cursor ahead of the data it describes
        // would skip those URLs for good.
        if (sinceCheckpoint >= CRAWL_CHECKPOINT_URLS) {
            sinceCheckpoint = 0;
            await flushCrawlBatch();
            await saveCrawlCursor(chunk[chunk.length - 1].id, urls_p + chunk.length - 1);
        }
    }

    await flushCrawlBatch();
    await clearCrawlCursor();
    setBadge('', true); // forced: the badge must end up cleared
    console.debug("getVisits() done.");
}

async function crawlUrlVisits(url_item) {
    let h;
    try {
        h = await new Promise(resolve => {
            chrome.history.getVisits({ url: url_item.url }, resolve);
        });
    } catch (e) {
        console.error("getVisits() error, url=" + url_item.url, e);
        return;
    }

    if (h.length < 1) {
        console.debug("getVisits() no data, url=" + url_item.url);
        return;
    }

    h.sort((a, b) => b.visitTime - a.visitTime);
    const loadfrom = (new Date()).getTime() - DAY * localStorage["load-range"];

    for (const v of h) {
        if (v.visitTime < loadfrom) {
            console.debug("add_history() time=" + v.visitTime + " < " + loadfrom + ", url=" + url_item.url);
            break;
        }

        const transition = v.transition;
        let refer = v.referringVisitId;

        if (transition == "typed" || transition == "auto_bookmark" ||
            transition == "keyword" || transition == "keyword_generated") {
            console.debug("change refer " + v.referringVisitId + "->0 cause transition=" + transition);
            refer = 0;
        }

        if (refer == undefined) refer = 0;

        visitBatch.push({
            visitId: v.visitId,
            referringVisitId: refer,
            url: url_item.url,
            visitTime: v.visitTime,
            title: url_item.title,
            transition: transition,
        });
        // Safe to call from several chunks at once: flushCrawlBatch() swaps
        // both arrays out before it awaits, so concurrent callers each get a
        // disjoint batch. It is here to bound memory when one URL has a very
        // long visit list.
        if (visitBatch.length >= VISIT_FLUSH_SIZE) await flushCrawlBatch();
    }

    // Stamp the crawl window on a copy rather than on `url_item` itself: six of
    // these run at a time, and writing back to the shared record after the
    // await is exactly the shape `require-atomic-updates` flags. Nothing reads
    // `url_item` afterwards, so the copy is what gets written either way.
    urlBatch.push(Object.assign({}, url_item, {
        loadfrom: loadfrom,
        loadto: h[0].visitTime,   // always the first visit time, as before
    }));
    if (urlBatch.length >= VISIT_FLUSH_SIZE) await flushCrawlBatch();
}

/**
 * Where the previous worker got to.
 *
 * `urls_wait_load` is rebuilt from the database on every start, so the cursor
 * keeps both the id of the last URL written and its position: the id is
 * stable and exact, the position is the fallback for when the rebuilt list no
 * longer contains that id (it finished, or its visits are gone).
 */
function restoreCrawlCursor() {
    const area = sessionArea();
    if (!area) return Promise.resolve(0);
    // Same shape as saveSessionState(): get() can throw synchronously.
    return Promise.resolve().then(function () {
        return area.get(CRAWL_CURSOR_KEY);
    }).then(function (result) {
        const cursor = result && result[CRAWL_CURSOR_KEY];
        if (!cursor) return 0;
        if (!Number.isFinite(cursor.at) || Date.now() - cursor.at > CRAWL_CURSOR_TTL) return 0;

        const i = urls_wait_load.findIndex(function (u) {
            return String(u.id) === String(cursor.id);
        });
        if (i >= 0) return i + 1;
        // Not in the list any more. The position drifts only by the entries
        // removed ahead of it, so it costs a few re-crawled URLs at worst.
        return (cursor.pos > 0 && cursor.pos < urls_wait_load.length) ? cursor.pos : 0;
    }).catch(function (error) {
        console.warn('SW: could not read crawl cursor', error);
        return 0;
    });
}

function saveCrawlCursor(id, pos) {
    const area = sessionArea();
    if (!area) return Promise.resolve();
    return Promise.resolve().then(function () {
        return area.set({ [CRAWL_CURSOR_KEY]: { id: String(id), pos: pos, at: Date.now() } });
    }).catch(function (error) {
        console.warn('SW: could not persist crawl cursor', error);
    });
}

function clearCrawlCursor() {
    const area = sessionArea();
    if (!area) return Promise.resolve();
    return Promise.resolve().then(function () {
        return area.remove(CRAWL_CURSOR_KEY);
    }).catch(function (error) {
        console.warn('SW: could not clear crawl cursor', error);
    });
}

// Visit tab function — refactored from callback to async/await
async function visitTab(tab) {
    let url = tab.url;

    if (url == undefined || url == "") return;

    console.debug("visitTab() tabId=" + tab.openerTabId + " -> " + tab.id + " url=" + url);

    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(tab.title) == false && 
        (/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(tab.url) == false) {
        
        let now = new Date();
        // `date + DAY` would stringify the Date (ToPrimitive prefers a string
        // for `+`), after which `date.getTime()` — and therefore loadDate() —
        // throws. Add to the epoch value and build a new Date from it.
        if (new Date() - date > DAY)
            date = new Date(date.getTime() + DAY);

        let details = { url: tab.url };
        
        try {
            let h = await new Promise(resolve => chrome.history.getVisits(details, resolve));
            if (h.length < 1) {
                console.debug("visitTab(" + tab.id + ") no data, url=" + tab.url);
            } else {
                h.sort(function (a, b) { return b.visitTime - a.visitTime });
                let loadfrom = (new Date()).getTime() - 1000000;
                add_tab_history(h, 0, loadfrom, { id: tab.id, url: tab.url, title: tab.title, lastVisitTime: now });
            }
        } catch (error) {
            console.error("visitTab() error:", error);
        }
    }
}

// Add tab history function
function add_tab_history(visitItems, i, loadfrom, url_item) {
    let refer2;
    let tabstr = url_item.id.toString();
    if (openerJson[tabstr] != undefined) {
        refer2 = urlIdJson[openerJson[tabstr]];
        delete openerJson[tabstr];
    }

    if (refer2 == undefined) refer2 = 0;

    if (visitItems.length > i) {
        let visitTime = visitItems[i].visitTime;
        let visitId = visitItems[i].visitId;
        let refer = visitItems[i].referringVisitId;
        let transition = visitItems[i].transition;

        if (visitTime < loadfrom) {
            console.debug("[Err] add_tab_history() time=" + visitTime + " < " + loadfrom + ", url=" + url_item.url);
            return;
        }

        if (idUrlJson[visitId.toString()] == undefined) {
            urlIdJson[url_item.url] = visitId;
            idUrlJson[visitId.toString()] = url_item.url;
            console.debug("visitJson " + refer + "->" + visitId + " transition=" + transition + " " + url_item.url);
            trimVisitIdMaps();
            scheduleSessionSave();
        }

        if (refer == undefined || refer <= 0) {
            if (refer2 == undefined || refer2 <= 0) {
                refer = 0;
            } else {
                refer = refer2;
            }
        }

        if (idUrlJson[refer.toString()] == undefined) {
            if (idUrlJson[refer2.toString()] != undefined) {
                refer = refer2;
            } else if (transition == "link" && tabUrl0Json[tabstr] != undefined) {
                refer = urlIdJson[tabUrl0Json[tabstr]];
            }
        }

        if (refer == undefined) {
            refer = 0;
        } else if (transition == "typed" || transition == "auto_bookmark" || 
                   transition == "keyword" || transition == "keyword_generated") {
            console.debug("change refer " + visitItems[i].referringVisitId + "->0 cause transition=" + transition);
            refer = 0;
        }

        console.debug("refer referringVisitId/refer2/tabUrl0/result=" + visitItems[i].referringVisitId + "/" + 
            refer2 + "/" + urlIdJson[tabUrl0Json[tabstr]] + "/" + refer + ", transition=" + transition + 
            " " + tabUrl0Json[tabstr] + " ->" + url_item.url);

        dbManager.putVisitItem({
            visitId: visitId,
            referringVisitId: refer,
            url: url_item.url,
            visitTime: visitTime,
            title: url_item.title,
            transition: transition,
        }).catch(error => {
            console.error("Error adding tab history:", error);
        });
    } else {
        console.debug("add_tab_history() no_result ");
    }
}

// Entry points a page may reach through the message channel. Dispatch used to
// be `self[message.function](...)`, which made every global in this service
// worker — internal helpers included — callable by name from any sender.
const CALLABLE_FUNCTIONS = {
    // The only name messageAdapter ever passes. Its MV3 route calls dbManager
    // directly, so this just keeps the documented fallback working.
    deleteDb: () => dbManager.deleteDB(),
};

function handleCallFunction(message, sender, sendResponse) {
    if (!sender || sender.id !== chrome.runtime.id) {
        sendResponse({ error: 'Rejected: foreign sender' });
        return true;
    }

    // Own property only: a bare `CALLABLE_FUNCTIONS[name]` would also resolve
    // inherited members such as `toString` and `constructor`, which would put
    // the whitelist back to "any function reachable by name".
    const fn = Object.hasOwn(CALLABLE_FUNCTIONS, message.function)
        ? CALLABLE_FUNCTIONS[message.function]
        : undefined;
    if (typeof fn !== 'function') {
        sendResponse({ error: 'Function not found' });
        return true;
    }

    // Answered from a promise callback, so `true` is returned to keep the port
    // open past this turn of the event loop.
    Promise.resolve()
        .then(() => fn(...(Array.isArray(message.args) ? message.args : [])))
        .then(
            (result) => sendResponse({ result }),
            (error) => sendResponse({ error: error.message })
        );

    return true;
}

// Message handler for MV3 compatibility
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
        return;
    }

    switch (message.action) {
        case 'getData':
            if (message.key === 'recentTabs') {
                sendResponse(recentTabs);
            } else if (message.key === 'openedTabs') {
                sendResponse(openedTabs);
            } else {
                sendResponse(undefined);
            }
            break;

        case 'callFunction':
            // Returned because the reply is sent from a promise callback.
            return handleCallFunction(message, sender, sendResponse);

        case 'refreshContextMenu':
            // Re-read favicon cache config from storage
            _shareFaviconCache = localStorage['share-favicon-cache'] !== 'no';
            initContextMenu();
            sendResponse({ result: true });
            break;

        case 'clearFaviconCache':
            caches.delete(FAVICON_CACHE).then(function (deleted) {
                // Re-create empty cache for future use
                if (deleted) {
                    caches.open(FAVICON_CACHE);
                }
                sendResponse({ result: deleted });
            });
            // Also clear negative cache
            localStorage.removeItem('favicon-negative-cache');
            return true; // Keep channel open for async response

        default:
            sendResponse(undefined);
    }

    return true;
});

console.log("Service Worker loaded (" + (performance.now() - _tSW).toFixed(1) + "ms)");
_tSW_load = performance.now();
