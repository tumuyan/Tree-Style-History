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

// The crawl alarm's name, declared here rather than with the crawl's other
// constants further down: `const` sits in the temporal dead zone until
// execution reaches it, and the alarms.onAlarm listener registered near the top
// of this file reads this one — at registration time, not at firing time.
const CRAWL_ALARM = 'crawlHistory';

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

// `{ <dayKey>: <visit count> }` gathered by the crawl as it walks. Accumulated
// across the passes of one window and flushed into `calendar_storage2` by
// saveCrawledHeat() only once that window is finished — a pass that stops at
// its budget has counted only part of the window.
var heatDays = {};

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
//
// Both names come from background-utils.js (i.e. modules/shared/format.js),
// where the popup reads them too. They are NOT re-declared here: a top-level
// `const` and the `var` the generated file declares collide at global scope,
// which is a SyntaxError that kills the whole worker.
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

// Hard cap on how many URLs the cache remembers.
//
// The cache lived in `chrome.storage.local` as one JSON string, and nothing
// ever removed an entry that was still inside its TTL. Every popup open adds
// one per row whose icon failed, so a browser pointed at an unreachable
// favicon service grew it for as long as that stayed true: measured 20k
// entries is 1.3MB, and the numbers below are what that costs.
//
// `getNegativeCache()` is a `JSON.parse()` of the whole string and
// `setNegativeCache()` a `JSON.stringify()` of it, so *every* add is a
// full read-modify-write of the entire cache. Per add, measured in the
// service worker:
//
//     0 entries      0.03ms read    0.16ms write
//     2k entries     0.53ms read    1.88ms write
//     10k entries    2.18ms read   10.6ms  write
//     40k entries   12.15ms read   51.4ms  write
//
// A 16-row popup whose icons all fail is 16 adds, i.e. ~180ms of solid
// service-worker CPU at 10k entries and ~800ms at 40k. That runs on the
// worker that is simultaneously answering those very requests, and on a
// cold start it competes with the startup crawl.
//
// Capping it is the whole fix for the growth; the TTL sweep alone never
// fires while entries keep arriving faster than they expire.
//
// It is not the fix for the *per-add* cost: once the cache sits at the cap,
// each add still costs a full parse plus a full stringify, which is where
// the ~0.9ms/entry measured at 5000 entries comes from. That is what the
// batched write below is for.
const NEGATIVE_CACHE_MAX = 2000;

// How long a batch of failures is held before it is written back.
//
// One popup open used to mean one read-modify-write per failed icon, because
// each `addNegativeCache()` call stands alone. Holding them for a tick turns
// that into one read-modify-write for the whole burst, which is the shape
// the cost above actually has.
//
// Short on purpose: a worker that is recycled before the timer fires loses
// the batch, and the worst case for a lost batch is one extra fetch per URL.
// It is not periodic work, so `setTimeout` is fine here — unlike the alarms
// below, this one never has to survive a recycle.
const NEGATIVE_CACHE_FLUSH_MS = 100;

// Hold the parsed object instead of re-parsing on every single lookup: the
// parse is O(size of cache) and `handleFaviconRequest()` calls this twice per
// icon (once for the URL, once for the fallback).
//
// It lives in module scope, so it dies with the worker — one extra parse per
// restart, which is nothing. Staleness is the risk, and there are exactly two
// writers: this worker (every path goes through `setNegativeCache()`, which
// refreshes the copy) and the options page's "clear icon cache", which
// removes the key outright and is handled by the `onChanged` listener below.
var _negativeCache = null;

// Failures that have been recorded but not written back yet. Consulted by
// `isNegativeCached()` so a batch still suppresses its own URLs before it
// lands in storage.
var _negativePending = {};
var _negativeFlushTimer = null;

function getNegativeCache() {
    if (_negativeCache) return _negativeCache;
    try {
        _negativeCache = JSON.parse(localStorage['favicon-negative-cache'] || '{}');
    } catch {
        _negativeCache = {};
    }
    return _negativeCache;
}

function setNegativeCache(cache) {
    _negativeCache = cache;
    try {
        localStorage['favicon-negative-cache'] = JSON.stringify(cache);
    } catch {}
}

/**
 * Drop the oldest entries until the cache is back under the cap.
 *
 * `Object.keys()` walks string keys in insertion order, so the front of the
 * map *is* the oldest entry — no timestamps need comparing.
 */
function evictNegativeCache(cache) {
    var keys = Object.keys(cache);
    var excess = keys.length - NEGATIVE_CACHE_MAX;
    for (var i = 0; i < excess; i++) {
        delete cache[keys[i]];
    }
}

/**
 * Drop entries that are past their TTL.
 *
 * Deliberately not part of the write path: it is O(size of cache) on top of
 * a write that is already O(size of cache), and the cap eviction above keeps
 * the size bounded anyway — so sweeping on every add buys nothing that the
 * eviction does not, and costs a second pass over the whole map. It rides
 * the existing most-visited alarm instead, which costs no extra wake-up: an
 * alarm wakes the worker, and a worker that wakes runs the startup crawl.
 */
function sweepNegativeCache() {
    var cache = getNegativeCache();
    var now = Date.now();
    var keys = Object.keys(cache);
    var expired = 0;
    for (var i = 0; i < keys.length; i++) {
        if (now - cache[keys[i]] > NEGATIVE_CACHE_TTL) {
            delete cache[keys[i]];
            expired++;
        }
    }
    if (expired) setNegativeCache(cache);
}

/**
 * Write every pending failure back in one pass: one parse, one prune, one
 * stringify for the whole batch instead of one round trip per URL.
 */
function flushNegativeCache() {
    _negativeFlushTimer = null;
    var urls = Object.keys(_negativePending);
    _negativePending = {};
    if (urls.length === 0) return;
    var cache = getNegativeCache();
    var now = Date.now();
    for (var i = 0; i < urls.length; i++) {
        cache[urls[i]] = now;
    }
    // After the insert, so the new entries cannot be the ones evicted and
    // the cache comes out at exactly the cap rather than one over.
    if (Object.keys(cache).length > NEGATIVE_CACHE_MAX) {
        evictNegativeCache(cache);
    }
    setNegativeCache(cache);
}

function addNegativeCache(url) {
    if (!url) return;
    _negativePending[url] = true;
    if (_negativeFlushTimer === null) {
        _negativeFlushTimer = setTimeout(flushNegativeCache, NEGATIVE_CACHE_FLUSH_MS);
    }
}

// The options page's "clear icon cache" removes the key from another context,
// which does not go through `setNegativeCache()`. Drop the parsed copy when
// that happens, or the worker keeps suppressing URLs the user just unblocked.
//
// Only a *removal* invalidates. `setNegativeCache()` — the only other writer,
// and it lives here — also arrives on this listener, as a change with a
// `newValue`; treating that as foreign would discard the copy this worker
// just wrote and re-parse the cache on the very next lookup, i.e. undo the
// caching on every single add.
chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local') return;
    var change = changes['favicon-negative-cache'];
    if (change && !('newValue' in change)) {
        _negativeCache = null;
        _negativePending = {};
    }
});

function isNegativeCached(url) {
    if (!url) return false;
    if (_negativePending[url]) return true;
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

    // The crawl's own paced passes. The startup crawl below is the first one;
    // this is what keeps the window warm afterwards, so a long browsing session
    // is not left waiting for the next worker start.
    scheduleCrawl();
    
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
        // Piggybacked on a wake-up that is already paid for: a new alarm of
        // its own would wake the worker — and re-run the startup crawl — for
        // nothing but a map sweep.
        sweepNegativeCache();
    } else if (alarm.name === CRAWL_ALARM) {
        // A pass, not the whole window: processVisits() stops when it has spent
        // its budget and the next alarm resumes from the cursor. Nothing here is
        // awaited by an event handler, so the pass simply runs.
        //
        // The crawl reads `load-range` out of the storage cache, so it starts
        // from the same hook the startup path does instead of assuming the
        // cache is there.
        //
        // No catch: loadHistory() logs its own failure and swallows it, and it
        // is also what serialises this pass against the startup one — calling
        // it is all this listener has to do.
        onStorageReady(function () {
            loadHistory();
        });
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
    var infmv = MOST_VISITED_MAX;
    var r = 0;

    // maxResults is the number of candidates to rank, not 0 (all of history).
    // This runs on every service-worker start, on the same task as
    // initializeStorageState() — an unbounded search is the kind of query that
    // keeps the worker busy for hundreds of milliseconds. 500 candidates is far
    // more than the MOST_VISITED_MAX rows kept in `mv-cache`, and the
    // RECENT_HISTORY_DAYS window is enforced in JS instead of in the query, so
    // the ranking is unchanged.
    //
    // Note the search is *not* sorted by visitCount: chrome.history returns
    // most-recent-first, so this ranks the 500 most recent pages rather than
    // the 500 most visited overall. "Most visited" here has always meant
    // "most visited among recent pages", and narrowing the window narrows that
    // further — deliberately, in exchange for a worker that starts promptly.
    chrome.history.search({ text: '', maxResults: 500 }, function (hi) {
        if (hi.length > 0) {
            var cutoff = (new Date()).getTime() - (RECENT_HISTORY_DAYS * DAY);
            // `lastVisitTime` is always present on a chrome.history result —
            // a missing one there is not a case worth a branch.
            hi = hi.filter(function (h) { return h.lastVisitTime >= cutoff; });
            hi.sort(function (a, b) { return b.visitCount - a.visitCount });

            for (let i = 0; i < hi.length; i++) {
                if (r == infmv) { break; }

                if (hi[i] !== undefined) {
                    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(hi[i].title) == false && 
                        INTERNAL_URL.test(hi[i].url) == false) {

                        // The time-of-day a page was last visited was computed
                        // here and dropped on the floor — mostVisited() in
                        // popup-core.js builds its items without it.
                        //
                        // Raw, not escaped. It used to be
                        // `title.replace(/"/g, '&#34;')` here, and mostVisited()
                        // hands it to formatItem(), which escapes again: a title
                        // of `say "hi"` was stored as `say &#34;hi&#34;` and
                        // came out as the literal text `say &amp;#34;hi&amp;#34;`.
                        var title = hi[i].title;
                        var url = hi[i].url;
                        var furl = getFaviconUrl(hi[i].url);

                        if (title == '') {
                            title = url;
                        }

                        mv.push({ 
                            url: url, 
                            favicon: furl, 
                            title: title, 
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
    // Number() is not a bug fix here: `>` coerces its right operand anyway, so
    // 11 > "10" was already true. It is written out because the value is a
    // string and every arithmetic use below would otherwise rely on that
    // coercion being remembered — and because the badge subtracts, where
    // "120" - 3 happens to work for the same reason.
    const loadRange = Number(localStorage['load-range']);
    if (dateId > loadRange) {
        console.debug("loadDate done. dateId = " + dateId + ">" + loadRange);
        localStorage['calendar-storage'] = JSON.stringify(calendar_r);
        chrome.action.setBadgeText({ text: "Url" });
        loadHistory();
        return;
    }

    chrome.action.setBadgeText({ text: "D" + (loadRange - dateId) });

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
        let obj = { text: '', maxResults: 0, startTime: date - DAY, endTime: date };

        try {
            let hi = await new Promise(resolve => chrome.history.search(obj, resolve));
            if (hi.length > 0) {
                hi.sort(function (a, b) { return b.visitCount - a.visitCount });
            }
            // No heat-map write here. This loop reads the last `load-range`
            // days on *every* start only to prime the tab/tree data, and doing
            // that work is the option's own documented cost ("consumes
            // resources to cache"). The map is filled once by the crawl in
            // processVisits(), which walks visits (not row summaries) and can
            // reach days older than this window; the one day neither of them
            // writes is today, which belongs to the page (see
            // saveCrawledHeat()).
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

// --- Crawl pacing ---------------------------------------------------------
//
// The crawl is the job that fills the tree and the heat map. It used to be one
// pass over the whole window, started once. Raising the frequency without
// lowering the cost of a pass would just run that pass more often, so a pass is
// now bounded: a window too large to finish in one is covered by several
// consecutive ones, each resuming from the position the last persisted.
//
// Every constant here is declared before any function below reaches for it,
// `loadHistory()` included. `const` sits in the temporal dead zone until
// execution reaches the declaration, so one placed after its caller throws —
// and only on the path that caller starts.
//
// How many URLs one pass may look at. This is the point of the change: a pass
// costs at most this many getVisits() round trips whatever the window holds.
const CRAWL_BUDGET_URLS = 300;
// Sweeping the window in passes is not free — each pass re-reads the URL list
// and re-derives the queue — so the period is a floor, not a target. A pass
// costs one `chrome.history.search`, one IndexedDB scan and at most
// `CRAWL_BUDGET_URLS` getVisits() round trips; at 15 minutes that is a
// rounding error next to the browsing that produced the history.
//
// Not configurable: an option would have to be validated against Chrome's own
// floor (alarms below ~30s are throttled to it), and the value that matters is
// the one that keeps a pass short, which is the budget above.
const CRAWL_PERIOD_MINUTES = 15;
// How many URLs to ask chrome.history.getVisits() about at once. Six keeps
// the crawl moving without tripping the history API's own throttling.
const VISIT_CONCURRENCY = 6;
const CRAWL_CURSOR_KEY = 'crawl-cursor';
// The heat counts gathered by the passes of one window, added up until the
// window is finished. Session storage for the same reason as the cursor: the
// accumulator only means something next to the position it belongs to, and a
// recycled worker must resume both together.
const CRAWL_HEAT_KEY = 'crawl-heat';
// How often the crawl is flushed and its position persisted. ~500 URLs keeps
// the worst case for a recycled worker at half a chunk of wasted work while
// still committing one transaction per several hundred rows.
// Deliberately below `CRAWL_BUDGET_URLS`: a checkpoint is what survives a
// worker recycled mid-pass, so it has to be due at least once *within* a pass.
const CRAWL_CHECKPOINT_URLS = 200;
// A cursor older than this describes a URL list from a different sitting; new
// visits have changed it, so start over rather than trust the position.
const CRAWL_CURSOR_TTL = 6 * 3600 * 1000;
// When a finished sweep stops being authoritative. A sweep says "every URL in
// the window has been walked"; an hour later, the window holds URLs that were
// never walked, so the claim is dropped and the next pass covers the lot.
const CRAWL_SWEEP_KEY = 'crawl-sweep';
const CRAWL_SWEEP_TTL = 60 * 60 * 1000;

/**
 * Arm the crawl alarm for this browser session, once.
 *
 * The alarm outlives the worker, so it only has to be created when it is not
 * there yet. Re-creating it on every start would restart its countdown every
 * time — and a worker that is woken by browsing is woken far more often than
 * once a period, so an alarm re-armed on each start would never fire at all.
 */
function scheduleCrawl() {
    chrome.alarms.get(CRAWL_ALARM, function (existing) {
        if (existing) return;
        chrome.alarms.create(CRAWL_ALARM, { periodInMinutes: CRAWL_PERIOD_MINUTES });
    });
}

/**
 * When the window was last walked end to end — 0 when that was never, or too
 * long ago to still be true.
 *
 * Session storage: the claim is about the URLs in this window, which is exactly
 * as long-lived as the browser session holding them.
 */
async function readSweepCursor() {
    const area = sessionArea();
    if (!area) return 0;
    try {
        const result = await area.get(CRAWL_SWEEP_KEY);
        const at = result && result[CRAWL_SWEEP_KEY];
        if (!Number.isFinite(at)) return 0;
        return (Date.now() - at <= CRAWL_SWEEP_TTL) ? at : 0;
    } catch (error) {
        console.warn('SW: could not read the crawl sweep', error);
        return 0;
    }
}

function saveSweepCursor(at) {
    const area = sessionArea();
    if (!area) return Promise.resolve();
    return Promise.resolve().then(function () {
        return area.set({ [CRAWL_SWEEP_KEY]: at });
    }).catch(function (error) {
        console.warn('SW: could not persist the crawl sweep', error);
    });
}

// Load history function
//
// Reads the window's URLs out of IndexedDB and walks them. Called on every
// start, which is what raises the frequency: a pass is bounded by
// `CRAWL_BUDGET_URLS`, so several short passes (one per start) cover a window
// that no single one of them could.
//
// One pass at a time. A worker woken by the crawl alarm runs two of them: the
// startup crawl (loadDate() -> loadHistory()) and the alarm's own, and the two
// interleave rather than queue. Both rebuild `urls_wait_load` from under each
// other, both reset `heatDays` (so the surviving walk writes a visit count that
// is missing the other's half — and that count is a never-overwritten cache, so
// nothing corrects it later), and every URL in the overlap reaches getVisits()
// twice. The pass already running covers both callers: if it does not finish,
// the next alarm resumes from the cursor it left behind.
//
// The guard is here rather than in processVisits() because a workflow that
// deliberately calls processVisits() directly is not a pass — it has already
// decided what the queue is.
var _crawlPass = null;

function loadHistory() {
    if (_crawlPass) {
        console.debug('loadHistory(): a pass is already running');
        return _crawlPass;
    }
    const pass = runCrawlPass().then(function (result) {
        _crawlPass = null;
        return result;
    }, function (error) {
        // Cleared on this path too, and swallowed: the two callers are an alarm
        // listener and loadDate()'s day loop, neither of which can recover.
        // Propagated instead, it would only reappear as an unhandled rejection
        // saying the same thing. Leaving the flag up would be worse than the
        // failure: it would stop the crawl for the life of the worker.
        _crawlPass = null;
        console.error('loadHistory() pass failed:', error);
    });
    // Assigned after the call and before anything can await, so there is no
    // window in which a second caller sees the flag down and starts a pass.
    _crawlPass = pass;
    return pass;
}

/** The body of one crawl pass. Called through `loadHistory()`, never directly. */
async function runCrawlPass() {
    let urls;
    try {
        urls = await dbManager.queryURLs({
            index: 'lastVisitTime',
            range: IDBKeyRange.lowerBound((new Date()).getTime() - DAY * Number(localStorage["load-range"])),
            direction: 'next'
        });
    } catch (error) {
        console.error('loadHistory() Error:', error);
        return;
    }

    // Un-crawled, or crawled before their most recent visit: the same filter as
    // before, now deferred to here so the sweep below can narrow it further.
    urls_wait_load = urls.filter(function (url) {
        return !url.loadto || url.loadto < url.lastVisitTime;
    });

    const sweepAt = await readSweepCursor();
    await processVisits(sweepAt);
}

// Process visits - async/await refactored from getVisits/add_history/update_urls
//
// The crawl walks every URL in the configured range and asks the history API
// for its visits. One `await` per URL meant tens of thousands of sequential
// round trips — slow enough that the worker was usually recycled before it
// finished, and a restart began again from zero, so a large history could
// never be crawled at all. It now goes in chunks, and the position is
// persisted so a restart picks up where it stopped.
//
// It also stops after `CRAWL_BUDGET_URLS` URLs instead of crawling to the end.
// A bounded pass is what lets the crawl run on every worker start rather than
// once a day: whatever a pass does not reach, the next one resumes from the
// cursor it left behind. Nothing is lost, and no single pass is long enough to
// be worth noticing.
//
// @param {number} [sweepAt] when the window was last walked end to end. URLs
//   last visited before then were already crawled, so they are skipped — a pass
//   after a completed sweep only looks at what arrived since. 0 walks
//   everything.
async function processVisits(sweepAt) {
    const sweep = Number(sweepAt) || 0;
    // The cursor indexes `urls_wait_load` — the whole window — so it is read
    // before anything is filtered out. A position into a filtered list would
    // point at a different URL as soon as the next pass filters differently.
    const cursor = await restoreCrawlCursor();
    const start = cursor.start;
    // Only from the beginning of the walk, and only when nothing is being
    // resumed: a resume means the last pass did not finish, and "everything
    // older than the sweep is already crawled" would then drop precisely the
    // URLs that pass never reached.
    //
    // Keyed on `resumed`, not on `start === 0`: a cursor that no longer resolves
    // also starts at 0, and filtering *that* pass down to "new since the sweep"
    // would skip the older half of a window nobody has walked yet.
    const incremental = !cursor.resumed && sweep > 0;
    // `lastVisitTime` older than the sweep: that sweep crawled it, and nothing
    // has happened to it since.
    const queue = incremental
        ? urls_wait_load.filter(function (url) { return url.lastVisitTime > sweep; })
        : urls_wait_load;
    console.debug("getVisits() start=" + start + "/" + queue.length +
        (incremental ? " (sweep=" + sweep + ")" : " (full)"));

    // The crawl is also where the heat map's back-fill comes from: it is
    // already walking every visit of every URL in the window, so counting them
    // per day costs no extra history API calls (a per-day `chrome.history.search`
    // would be one full scan per day, which is what this crawl exists to avoid).
    // What lands in the map is decided by saveCrawledHeat() once the walk is
    // over; today's bucket is gathered here like any other and dropped there.
    //
    // On the module, not a local: crawlUrlVisits() runs concurrent chunks and
    // cannot borrow the loop's variables, and this is the same shape as the
    // other crawl accumulators (visitBatch / urlBatch).
    //
    // Continued, not reset, when this pass resumes another one: a window too big
    // for one pass is counted in pieces, and a piece thrown away here is not
    // recoverable later — saveCrawledHeat() keeps the first number a day gets.
    //
    // Nothing to resume means a new window (nothing to continue): any
    // accumulator still stored belongs to a window that is gone — a cursor that
    // expired, or one cleared by a pass that finished — and it has to be
    // dropped, not just ignored: a later checkpoint in *this* window writes a
    // cursor, and the pass resuming it would read the stale counts back in and
    // add them to the sum.
    //
    // `resumed`, not `start > 0`, for the reason spelled out on
    // restoreCrawlCursor(): a window whose head has already been walked and
    // stamped resumes at 0, and dropping the accumulator there throws away
    // exactly the counts that window is still owed.
    if (cursor.resumed) {
        heatDays = await restoreCrawlHeat();
    } else {
        heatDays = {};
        await clearCrawlHeat();
    }
    let sinceCheckpoint = 0;
    let urls_p = start;
    let walked = 0;
    for (; urls_p < queue.length && walked < CRAWL_BUDGET_URLS; urls_p += VISIT_CONCURRENCY) {
        setBadge((queue.length - urls_p).toString());

        const chunk = queue.slice(urls_p, urls_p + VISIT_CONCURRENCY);
        // allSettled, not all: a URL that throws must not abandon the URLs
        // queued next to it.
        const results = await Promise.allSettled(chunk.map(crawlUrlVisits));
        for (const r of results) {
            if (r.status === 'rejected') console.error("crawlUrlVisits() failed", r.reason);
        }

        walked += chunk.length;
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
            await saveCrawlState(chunk[chunk.length - 1].id, urls_p + chunk.length, heatDays);
        }
    }

    await flushCrawlBatch();
    const complete = urls_p >= queue.length;
    if (walked === 0 && !cursor.resumed) {
        // An empty pass is the steady state now that passes are periodic: after
        // a completed sweep, a pass with nothing new to walk is the *expected*
        // outcome, not an accident. Every path that reaches here has already
        // written `Url` (loadDate() hands the badge over when its day loop ends)
        // or a `D<n>`, so returning without clearing it parks that marker on the
        // toolbar until the next non-empty pass — one leftover per period, i.e.
        // permanently, since nothing else ever touches the badge.
        //
        // Told apart from a resumed pass that finds nothing left by `resumed`,
        // not by `walked`: with a window in hand there is something to close,
        // and the accumulated counts of the passes that walked it are still owed
        // to the map. A resume can land here with a position of 0 — the window
        // shrank to nothing, or its head was already walked — which is why the
        // distinction cannot be read off the position.
        setBadge('', true);
        return;
    }
    if (complete) {
        // The map before the bookkeeping: it is where the counts belong, and
        // everything above already reached the database (see flushCrawlBatch()).
        //
        // Keyed on `complete`, not on `walked`. A pass that stops at its budget
        // has counted part of the window, and a partial count written to the map
        // is never corrected: saveCrawledHeat() only fills days that are empty,
        // so the first number a day gets is the one that stays. `heatDays` here
        // is the sum over every pass of this window, not just this pass's share.
        saveCrawledHeat(heatDays);
        await clearCrawlState();
        // Last, and after the flush: the sweep is the promise "every URL that
        // existed when this ran is in the database". Recorded earlier, a sweep
        // could claim URLs that did not reach it.
        await saveSweepCursor(Date.now());
    } else {
        // Budget spent, not a finished walk. Cursor and counts in one write, so
        // a worker recycled between them cannot resume one without the other.
        // The id is what the next pass resumes from; the position is its
        // fallback for when the rebuilt list no longer holds that id.
        await saveCrawlState(queue[urls_p - 1].id, urls_p, heatDays);
    }
    setBadge('', true); // forced: the badge must end up cleared
    console.debug("getVisits() done. " + walked + " url(s)" +
        (complete ? ", window complete" : ", resuming next pass"));
}

/**
 * Fill in the heat map for the days the crawl just walked.
 *
 * `days` is `{ <dayKey>: <count> }` gathered by countHeatVisit(). The rule is
 * per day, and it needs no extra state: write a day that holds nothing usable,
 * leave every other day exactly as it is. A day the map already has a count for
 * is one the crawl is *not* authoritative about — it was counted by an earlier
 * crawl over the same window, or by the page while the user looked at it, and
 * neither number is a recomputation of the other. So an existing count stays
 * until the retention cleanup deletes the day (`load-range3`, off by default),
 * at which point the day is empty again and refills on the next start.
 *
 * That is also why today is never written here. Today is the one day that keeps
 * moving, and the page is its authority: it counts the day it is displaying
 * (history() -> save_calendar_storage2(..., overwrite: true)) and it is the only
 * surface that sees browsing which happened after this crawl ran. A count taken
 * here would be the state of the day at crawl time, and — being non-zero — would
 * then hide today from the crawl forever, outliving the page that wrote a fresher
 * one. Today is simply not this function's business.
 *
 * Note this records *visits*, while the page counts *rows* (one per URL). The
 * two only agree for a day browsed one page at a time; the counters live on
 * either side of the SW/page split. The alternative — `chrome.history.search`
 * per day, which is what produced the page's row counts — costs one full history
 * scan per day of the window on *every* service worker start, which is what the
 * crawl exists to avoid.
 */
function saveCrawledHeat(days) {
    // The key of the day in progress, computed once. Comparing the numeric keys
    // (not the strings they are stored as) is what makes the skip exact: a
    // millisecond off is a different day.
    const todayKey = dayKey(Date.now());
    let stored = false;
    for (const key of Object.keys(days)) {
        const n = days[key];
        if (n < 1) continue;
        if (Number(key) === todayKey) continue;
        if (calendar_storage2[key] != undefined) continue;
        calendar_storage2[key] = n;
        stored = true;
    }
    if (stored) localStorage['calendar-storage2'] = JSON.stringify(calendar_storage2);
}

/**
 * Count one visit towards its day in `days`, skipping nothing.
 *
 * Counts every visit whose `title`/`url` pair is not itself a browser-internal
 * page — the same rule add_urls() uses to decide what goes into the database —
 * so the square says what the tree below it can show. It does not apply
 * `filtUrl()` (user-configured host filtering): that lives page-side in
 * config.js and is not available to the worker, so a filtered day's square can
 * count rows the list hides. That is one level of slop looser than the row
 * count the page produces — which, together with "today keeps moving", is why
 * today is left to the page rather than counted here (see saveCrawledHeat()).
 */
function countHeatVisit(days, v, url_item) {
    const title = url_item.title;
    const url = url_item.url;
    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(title)) return;
    if ((/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(url)) return;

    const key = dayKey(v.visitTime);
    days[key] = (days[key] || 0) + 1;
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
    const loadfrom = (new Date()).getTime() - DAY * Number(localStorage["load-range"]);

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

        countHeatVisit(heatDays, v, url_item);

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
 *
 * `pos` is the *next* index, i.e. how many URLs of the list were walked — the
 * same thing the id path returns. The two used to disagree by one (the id path
 * returned `i + 1`, the stored position was the index of the last URL walked),
 * so a resume that fell back to the position re-walked it. One extra round trip
 * is not what that costs any more: the heat accumulator counts the visit again
 * and the day lands one too high, in a cache nothing recomputes.
 *
 * Returns `{ start, resumed }` rather than a bare position. The two are not the
 * same question: a position of 0 means "walk from the top", which is the right
 * answer both for a pass that has nothing to resume *and* for one whose cursor
 * no longer resolves — and the difference decides whether the pass may treat
 * the counts already gathered as belonging to a window that is gone. `resumed`
 * is "there is an unfinished window", the position is "how much of it looks
 * already walked". Collapsing them is what made a resume look like a fresh
 * start: `crawlUrlVisits()` stamps `loadto`, `loadHistory()` filters stamped
 * URLs out of the next list, so by the second pass of a window the cursor's id
 * is gone and its position (299) is past the end of what is left (50). Both
 * fallbacks fail, the position comes back 0, and the accumulator holding the
 * first pass's 300 counts is thrown away as stale — after which the pass that
 * finishes the window publishes only its own tail.
 */
function restoreCrawlCursor() {
    const gone = { start: 0, resumed: false };
    const area = sessionArea();
    if (!area) return Promise.resolve(gone);
    // Same shape as saveSessionState(): get() can throw synchronously.
    return Promise.resolve().then(function () {
        return area.get(CRAWL_CURSOR_KEY);
    }).then(function (result) {
        const cursor = result && result[CRAWL_CURSOR_KEY];
        if (!cursor) return gone;
        if (!Number.isFinite(cursor.at) || Date.now() - cursor.at > CRAWL_CURSOR_TTL) return gone;

        const i = urls_wait_load.findIndex(function (u) {
            return String(u.id) === String(cursor.id);
        });
        if (i >= 0) return { start: i + 1, resumed: true };
        // Not in the list any more — normal: those URLs were walked, stamped,
        // and filtered out. The position is only usable while the list is still
        // long enough for it to mean something.
        if (cursor.pos > 0 && cursor.pos <= urls_wait_load.length) {
            return { start: cursor.pos, resumed: true };
        }
        // Neither anchor resolves. Walk what is left from the top and keep the
        // counts: in this shape the URLs that were walked are the ones that left
        // the list, so starting over skips them rather than re-walking them. (A
        // URL whose write failed never got stamped, so it is re-walked and
        // recounted — a handful against a whole head of the window.)
        return { start: 0, resumed: true };
    }).catch(function (error) {
        console.warn('SW: could not read crawl cursor', error);
        return gone;
    });
}

/**
 * Persist where this pass stopped and what the passes so far have counted.
 *
 * One `set()` for both, deliberately: a cursor without its counts is a window
 * whose head is silently dropped (the pass resuming it publishes only the tail),
 * and counts without a cursor are counts for a walk that will start over
 * anyway. Writing them together is what makes "one without the other" a state
 * that cannot exist rather than one the code has to avoid by ordering its
 * awaits correctly.
 */
function saveCrawlState(id, pos, days) {
    const area = sessionArea();
    if (!area) return Promise.resolve();
    const heat = {};
    for (const key of Object.keys(days || {})) heat[key] = days[key];
    return Promise.resolve().then(function () {
        return area.set({
            [CRAWL_CURSOR_KEY]: { id: String(id), pos: pos, at: Date.now() },
            [CRAWL_HEAT_KEY]: heat,
        });
    }).catch(function (error) {
        console.warn('SW: could not persist crawl cursor', error);
    });
}

function clearCrawlState() {
    const area = sessionArea();
    if (!area) return Promise.resolve();
    return Promise.resolve().then(function () {
        return area.remove([CRAWL_CURSOR_KEY, CRAWL_HEAT_KEY]);
    }).catch(function (error) {
        console.warn('SW: could not clear crawl cursor', error);
    });
}

function clearCrawlHeat() {
    const area = sessionArea();
    if (!area) return Promise.resolve();
    return Promise.resolve().then(function () {
        return area.remove(CRAWL_HEAT_KEY);
    }).catch(function (error) {
        console.warn('SW: could not clear the crawl heat', error);
    });
}

/**
 * The heat counts gathered by the passes of the window being walked.
 *
 * A window larger than one pass is counted in pieces, and the map cannot take
 * the pieces separately: saveCrawledHeat() fills only empty days, so the first
 * piece written is the one that stays and every later piece is discarded. The
 * pieces therefore have to be added up somewhere and written once, when the
 * window is finished — and that somewhere has to outlive the worker, since the
 * passes of one window routinely land in different workers.
 *
 * Session storage, written by saveCrawlState() together with the cursor in a
 * single `set()`: the two describe the same walk, and either one on its own is
 * a window half counted. restoreCrawlHeat() is only meaningful right after
 * restoreCrawlCursor() reported `resumed` — a cursor that came back as "no
 * unfinished window" purges it instead.
 */
function restoreCrawlHeat() {
    const area = sessionArea();
    if (!area) return Promise.resolve({});
    return Promise.resolve().then(function () {
        return area.get(CRAWL_HEAT_KEY);
    }).then(function (result) {
        const days = result && result[CRAWL_HEAT_KEY];
        // A hand-edited or half-written value must not become the base of the
        // next sum; start over rather than propagate a NaN into the map.
        if (!days || typeof days !== 'object') return {};
        const out = {};
        for (const key of Object.keys(days)) {
            const n = Number(days[key]);
            if (Number.isFinite(n) && n > 0) out[key] = n;
        }
        return out;
    }).catch(function (error) {
        console.warn('SW: could not read the crawl heat', error);
        return {};
    });
}

// Visit tab function — refactored from callback to async/await
async function visitTab(tab) {
    let url = tab.url;

    if (url == undefined || url == "") return;

    // Our own pages are not browsing. Opening the popup navigates a tab to
    // chrome-extension://<id>/popup.html, which fires tabs.onUpdated and used
    // to land here: a getVisits() round trip per popup open that also filed a
    // "history" row for the extension's own UI. Worse, it is what wakes this
    // worker after it has been recycled — and a wake re-runs the startup crawl.
    // Bail out before doing any work.
    if (url.indexOf('chrome-extension://' + chrome.runtime.id) === 0) return;

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
    // Nothing in the extension sends it any more: options.js calls
    // dbManager.deleteDB() in its own page, which is all this used to forward
    // to. Kept so the dispatch table below is not empty — the table is the
    // point, and `getData` still answers from it.
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
            // The only two keys this ever answered were openedTabs and
            // recentTabs, and both readers are gone: the popup reads the
            // snapshot the worker mirrors into chrome.storage.session, which
            // costs no wake. Answering them here would mean a page could still
            // wake the worker for a list it can read for free.
            sendResponse(undefined);
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
            // Also clear negative cache, pending batch included: a batch that
            // survives this would be written straight back by its timer.
            _negativePending = {};
            _negativeCache = null;
            localStorage.removeItem('favicon-negative-cache');
            return true; // Keep channel open for async response

        default:
            sendResponse(undefined);
    }

    return true;
});

console.log("Service Worker loaded (" + (performance.now() - _tSW).toFixed(1) + "ms)");
_tSW_load = performance.now();
