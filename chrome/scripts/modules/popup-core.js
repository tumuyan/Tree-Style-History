import { $, $$, createElement } from '../dom-helper.js';
import {
    DAY, returnLang, escapeHtmlAttr, escapeHtmlText, timeNow, formatDate,
    getFaviconUrl, isBookmarkletUrl, executeBookmarklet,
    getFaviconOnerror, setupFaviconElement,
    Clipboard
} from './helpers.js';
import { filtUrl } from './config.js';
// Straight from the shared layer, like config.js does: only module code uses
// it, so it stays off `window` (tests/static.test.mjs keeps that surface honest).
import { INTERNAL_URL } from './shared/url.js';
import { RECENT_HISTORY_DAYS, MOST_VISITED_MAX, TAB_LIST_KEY, TAB_LIST_VERSION } from './shared/format.js';
import { modifierState } from './ui-state.js';

// Left click
function leftClick(url, event) {
    event = event || window.event;
    if (event) event.preventDefault();

    // Handle bookmarklets by executing them instead of navigating
    if (isBookmarkletUrl(url)) {
        executeBookmarklet(url, {
            decode: true,
            fallbackToUpdate: true,
            onSuccess: function () {
                // Close popup if needed
                if (!modifierState.ctrl && (localStorage['rh-click'] === 'newtab' || localStorage['rh-click'] === 'current')) {
                    window.close();
                }
            },
            onFailure: function (err) {
                console.warn('Bookmarklet execution failed:', err);
            }
        });
        return;
    }

    var ca = localStorage['rh-click'];
    if (modifierState.ctrl || (event && event.button == 1)) {
        chrome.tabs.create({
            url: url,
            selected: false
        });
    } else {
        if (ca == 'current') {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs[0]) {
                    chrome.tabs.update(tabs[0].id, { url: url }, function () {
                        window.close();
                    });
                }
            });
        } else if (ca == 'newtab') {
            chrome.tabs.create({
                url: url,
                selected: true
            });
            window.close();
        } else if (ca == 'newbgtab') {
            chrome.tabs.create({
                url: url,
                selected: false
            });
        }
    }
}


// Right click
function rightClick(url) {
    Clipboard.copy(url);
}


// Format item
function formatItem(data) {

    var item = '';
    var sobj = {};
    var rhsurl = localStorage['rhs-showurl'];
    var rhsext = localStorage['rhs-showext'];

    var url = data.url;
    var type = data.type;
    // Raw, and escaped at the interpolation site below. It used to go through
    // title_fix() here, which deleted '<', '>' and '/' — so "Docs / API" showed
    // up as "Docs  API".
    var title = data.title;
    var favicon = data.favicon;
    var time = data.time;

    if (data.visits !== undefined) {
        var visits = data.visits;
    } else {
        visits = '';
    }

    if (rhsurl == 'yes' || rhsext == 'yes') {
        var saext = 'style="margin-left: 2px;"';
    } else {
        saext = '';
    }

    if (rhsext == 'no') {
        var sext = 'style="display:none;"';
    } else {
        if (type == 'rh' || type == 'mv') {
            sext = '';
        } else {
            sext = 'style="display:none;"';
        }
    }

    if (rhsurl == 'no') {
        var surl = 'style="display:none;"';
    } else {
        surl = '';
    }

    if (localStorage['rhs-showsep'] == 'yes') {
        sobj['border-bottom'] = '1px solid #ccc';
    }

    if (rhsext == 'yes' && rhsurl == 'yes') {
        var extsep = ' | ';
    } else {
        extsep = '';
    }

    var tipParts = [];

    if (title && title !== '') {
        tipParts.push(title);
    }

    if (!isBookmarkletUrl(url) && url && title !== url) {
        tipParts.push(url);
    }

    if (time !== undefined && time !== null) {
        tipParts.push(time);
    }

    var tip = tipParts.join(' | ');
    if (!tip) {
        tip = isBookmarkletUrl(url) ? '[Bookmarklet]' : (url || '');
    }

    // A per-row "delete from history" button used to be drawn here (two spans,
    // `.ui-pin` / `.ui-delete`), but nothing ever bound a handler to them: the
    // functions that would have (uiPinItem/uiDeleteItem) had no callers, and
    // popup.html has no #alert-yes / #alert-no for their confirmation. So the
    // buttons were visible, hoverable and completely inert — worse than not
    // being drawn. Deleting is still available in the linear views, which do
    // wire it up.
    var faviconSrc = favicon;
    // 为不同类型的页面设置不同的图标
    if (isBookmarkletUrl(url)) {
        faviconSrc = 'images/iconmonstr-script-6.svg';
    } 
    // 检查是否是本扩展的设置页面
    else if (url.indexOf("extension://") !== -1    ||  url.indexOf("edge://extensions") !== -1  ) {
        // 检查是否是本扩展的页面
        try {
            var isOwnExtension = false;
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                isOwnExtension = url.indexOf(chrome.runtime.id) !== -1;
            }
            // 本扩展的设置页面使用tree-38.png
            faviconSrc = isOwnExtension ? 'images/tree-38.png' : 'images/Extension-icon-vector-04.svg';
        } catch {
            // 如果无法确定，使用通用扩展图标
            faviconSrc = 'images/Extension-icon-vector-04.svg';
        }
    }
    // 浏览器自身页面
    else if (url.indexOf("chrome://") === 0 || 
             url.indexOf("about:") === 0 || 
             url.indexOf("edge://") === 0 || 
             url.indexOf("opera://") === 0 ||
             url.indexOf("brave://") === 0) {
        faviconSrc = 'images/Browser-icon-vector-03.svg';
    }
    // 本地文件
    else if (url.indexOf("file://") === 0) {
        faviconSrc = 'images/iconmonstr-file-3.svg';
    }
    // 其他扩展页面
    else if(faviconSrc.indexOf("extension://") !== -1) {
        faviconSrc = 'images/Extension-icon-vector-04.svg';
    }

    if (faviconSrc) {
        item += '<img class="favicon" alt="Favicon">';
    }
    else {
        item += '<img class="favicon" alt="Favicon">';
    }

    // `tip` and `url` sit in attributes (escapeHtmlAttr); `title` is text
    // content and takes escapeHtmlText. It was interpolated raw here, relying
    // on title_fix() having deleted the angle brackets upstream — which the
    // storage side no longer does.
    item += '<span class="title" title="' + escapeHtmlAttr(tip) + '">' + escapeHtmlText(title) + '</span>';

    // For bookmarklets, show simplified URL in the extra-url section
    var urlDisplay = isBookmarkletUrl(url) ? 'javascript:...' : url.replace(/^(.*?)\:\/\//, '').replace(/\/$/, '');
    // Also a text position: urlDisplay is derived from the URL, and the
    // attribute escaper would rewrite its quotes to &quot;.
    item += '<span ' + saext + ' class="extra-url"><span ' + sext + ' class="extra">' + returnLang("visits") + ': ' + visits + extsep + '</span><span ' + surl + ' class="url">' + escapeHtmlText(urlDisplay) + '</span></span>';



    var click = function (e) {
        leftClick(url, e);
    };


    // switch tab
    if (data.tabId != undefined) {
        click = function (e) {
            openTab(data.tabId, e);
        }
    } else if (data.sessionId != undefined) {
        click = function () {
            chrome.sessions.restore(data.sessionId, function (session) { })
        }
    }


    var el = createElement('a', {
        'class': 'item',
        target: '_blank', // Note: no href attribute, so no default navigation — preventDefault() is unnecessary
        styles: sobj,
        html: item
    });
    el.addEventListener('click', click);
    el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        rightClick(url);
    });
    var faviconFallbackUrl = getFaviconOnerror(url);
    var imgEl = el.querySelector('img.favicon');
    if (imgEl) {
        setupFaviconElement(imgEl, faviconSrc, faviconFallbackUrl);
    }
    return el;

}


// Popup search
function popupSearch(q) {
    if (q !== '' && q !== undefined) {
        chrome.history.search({ text: q, maxResults: 30 }, function (hi) {
            if (hi.length > 0) {
                $('popup-search-insert').textContent = '';
                for (var i = 0; i < hi.length; i++) {
                    if (hi[i] !== undefined) {
                        var title = hi[i].title;
                        var url = hi[i].url;
                        var visits = hi[i].visitCount;
                        var furl = getFaviconUrl(hi[i].url);
                        if (title !== '') {
                            $('popup-search-insert').appendChild(formatItem({ type: 'rh', title: title, url: url, favicon: furl, visits: visits }));
                        }
                    }
                }
            } else {
                $('popup-search-insert').innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
            }
        });
    }
}


// Alert user popup
function alertUser(msg, action) {
    if (action == 'close') {
        $('alert-holder').style.display = 'none';
        var alertYes = $('alert-yes');
        var alertNo = $('alert-no');
        if (alertYes) alertYes.remove();
        if (alertNo) alertNo.remove();
    } else if (action == 'open') {
        $('alert-holder').style.display = 'block';
        $('alert-text').innerHTML = msg;
        setTimeout(function () {
            $('alert-holder').style.display = 'none';
        }, 3000);
    }
}


// Recent History
//
// The 28-day cutoff is applied here rather than in the query. Passing
// startTime/endTime makes the history backend scan by time range: measured on a
// profile with 80k URLs it was ~450ms with the window against ~45ms without.
// `chrome.history.search` returns most-recent-first either way, so dropping
// rows older than the window after the fact costs one comparison per row and
// changes nothing the user can see.
//
// `maxResults` is 4x the configured count because the loop below discards
// three kinds of row without spending a slot — internal URLs, filter-list hits,
// and now entries older than the window — so it has to be able to look past
// them or a filtered-down list would come back short.

function recentHistory() {

    var ir = 0;
    var rhin = Number(localStorage['rh-itemsno']);
    var rhino = rhin;
    rhin = rhin * 4;

    if (rhin > 0) {

        var cutoff = (new Date()).getTime() - (RECENT_HISTORY_DAYS * DAY);

        chrome.history.search({ text: '', maxResults: rhin }, function (hi) {

            if (hi.length > 0) {

                for (var i = 0; i < hi.length; i++) {

                    // `ir` steps by exactly one per row appended, so `>=` and
                    // `==` render the same number of rows here (checked over
                    // every quota x row-count x leading-skip combination; see
                    // popup-core.test.mjs, which says so rather than claiming
                    // to distinguish them). `>=` is only the sturdier spelling:
                    // it still stops once full if a later change skips several
                    // rows in one step, or starts `ir` above zero.
                    if (ir >= rhino) { break; }

                    if (hi[i] !== undefined) {

                        var title = hi[i].title;
                        var url = hi[i].url;

                        // Not "where you were browsing". Skipping must not
                        // increment `ir`: internal URLs would otherwise burn
                        // slots the user configured for real pages.
                        if (INTERNAL_URL.test(url)) {
                            continue;
                        }

                        // The same reasoning as above: an entry outside the
                        // window is not shown and must not count towards the
                        // quota.
                        if (hi[i].lastVisitTime < cutoff) {
                            continue;
                        }

                        var visits = hi[i].visitCount;
                        var furl = getFaviconUrl(hi[i].url);

                        if (title == '') {
                            title = url;
                        }

                        if (filtUrl(url) == false) {
                            $('rh-inject').appendChild(formatItem({ type: 'rh', title: title, url: url, favicon: furl, visits: visits, time: timeNow(hi[i].lastVisitTime) }));
                            ir++;
                        }
                    }

                }

            }

        });

    }

}


// Recently Closed Tabs
function recentlyClosedTabs() {

    var itemsno = Number(localStorage['rct-itemsno']);

    if (itemsno > 0) {

        chrome.sessions.getRecentlyClosed({
            maxResults: itemsno
        }, function (sessionInfos) {
            console.log(" sessions found " + sessionInfos.length)

            for (var i = 0; i < sessionInfos.length; i++) {
                var win;
                var sessionId;
                var title;
                var tab = sessionInfos[i].tab;
                if (tab == undefined) {
                    win = sessionInfos[i].window;
                    sessionId = win.sessionId;
                    tab = win.tabs[0];
                    title = "[" + win.tabs.length + "] " + tab.title;
                } else {
                    sessionId = tab.sessionId;
                    title = tab.title;
                }

                var url = tab.url;
                if (typeof url !== 'string') {
                    continue;
                }
                if (url.indexOf('chrome-extension://') == 0) {
                    continue;
                }

                var furl = tab.favIconUrl;
                // Generate favicon URL from page URL if tab has no favicon data
                if (!furl && typeof url === 'string') {
                    furl = getFaviconUrl(url);
                }

                if (title == '') {
                    title = url;
                }
                $('rct-inject').appendChild(formatItem({ type: 'rct', sessionId: sessionId, title: title, url: url, favicon: furl }));

            }


            if ($$('#rct-inject .item').length == 0) {
                $('rct-inject').style.display = 'none';
            }

            });

    }

}


function openTab(id) {
    chrome.tabs.get(id, (tab) => {
        chrome.windows.update(tab.windowId, { focused: true }, function () {
            chrome.tabs.update(id, { active: true });
        });
    });
};


// --- Recent tabs: where the data comes from --------------------------------
//
// This block used to fetch `openedTabs`/`recentTabs` with
// chrome.runtime.sendMessage. A message wakes the service worker, and a worker
// that wakes re-runs its entire startup crawl (a full-history search per day
// plus a getVisits pass) — seconds of work whose only result here is a list of
// tabs. On a cold start the reply was worse than the cost: the worker answers
// `getData` from module scope, which is empty until the live-tab query finishes,
// so the popup woke the worker to receive nothing.
//
// The worker now mirrors both fields into chrome.storage.session under
// TAB_LIST_KEY. Session storage lives in the browser process: reading it wakes
// nothing, touches no disk, and — unlike the worker's module scope — it
// survives the worker being recycled. The key and its version are imported
// from the shared bottom layer, which is where the worker reads them too.
function tabListArea() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session)
        ? chrome.storage.session
        : null;
}

function readTabList() {
    const area = tabListArea();
    if (!area) {
        return Promise.reject(new Error('chrome.storage.session is unavailable'));
    }
    // get() is called inside a then() rather than passed to Promise.resolve():
    // Chrome throws *synchronously* on a value it cannot read, i.e. before any
    // .catch() would be attached.
    return Promise.resolve().then(function () {
        return area.get(TAB_LIST_KEY);
    }).then(function (result) {
        const saved = result && result[TAB_LIST_KEY];
        if (!saved || saved.v !== TAB_LIST_VERSION) {
            throw new Error('no tab list snapshot');
        }
        return {
            openedTabs: saved.openedTabs || {},
            recentTabs: Array.isArray(saved.recentTabs) ? saved.recentTabs : [],
        };
    });
}

/**
 * Rebuild the list from live tabs when there is no snapshot — the first popup
 * after a browser start, if the worker has not saved yet.
 *
 * Activation order is not recoverable here: `tabs.Tab.lastAccessed` is Chrome
 * 121+ and the manifest floor is 102. The active tab therefore comes first and
 * the rest follow in window order — a stable list rather than an arbitrary one.
 */
function readTabListFromTabs() {
    return new Promise(function (resolve, reject) {
        chrome.tabs.query({}, function (tabs) {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message || 'chrome.tabs.query failed'));
                return;
            }
            const openedTabs = {};
            const active = [];
            const rest = [];
            for (const tab of tabs || []) {
                if (!tab || tab.id === undefined) { continue; }
                openedTabs[tab.id] = tab;
                (tab.active ? active : rest).push(tab.id);
            }
            rest.sort(function (a, b) {
                return ((openedTabs[a].windowId || 0) - (openedTabs[b].windowId || 0))
                    || ((openedTabs[a].index || 0) - (openedTabs[b].index || 0));
            });
            resolve({ openedTabs: openedTabs, recentTabs: active.concat(rest) });
        });
    });
}

// Recent Tabs in popup
function showRecentTabs(rhhistory, rt) {
    if (rhhistory !== undefined && rt !== undefined) {
        // Data provided directly, skip reading
        showRecentTabsImpl(rhhistory, rt);
        return;
    }
    readTabList().catch(function (reason) {
        console.debug('[Popup] no tab list snapshot (' + (reason && reason.message) + '), querying live tabs');
        return readTabListFromTabs();
    }).then(function (data) {
        showRecentTabsImpl(data.openedTabs, data.recentTabs);
    }).catch(function (err) {
        console.error('Failed to get tab data:', err);
        var el = $('rt-inject');
        if (el) el.style.display = 'none';
    });
}

// Not exported. showRecentTabs() is the one that normalises, and the whole point
// of this pair is that an odd-shaped snapshot cannot reach the renderer — an
// export would leave the next caller a way around that. tests/popup-core.test.mjs
// goes through showRecentTabs() for the same reason.
function showRecentTabsImpl(rhhistory, rt) {
    // A stored object is JSON round-tripped, so the fields can come back as
    // anything: a truncated write leaves `recentTabs` an object rather than an
    // array, and `rhhistory` missing entirely. Both are coerced here rather than
    // at the call site, because every caller is a `then()` over a storage read.
    rhhistory = (rhhistory && typeof rhhistory === 'object') ? rhhistory : {};
    // An array or nothing. Deliberately NOT coerced from an object: an object
    // has no `.length`, so the walk would end immediately and the block would
    // render empty without saying why — see "hides the block" in
    // tests/popup-core.test.mjs.
    rt = Array.isArray(rt) ? rt : [];
    console.log("showRecentTabs() count = " + rt.length);

    var tDataReady = (performance.now() - (window._htmlStartTime || performance.now())).toFixed(1);
    console.log('[Popup] Data ready (click to render): ' + tDataReady + 'ms');

    var itemsno = Number(localStorage['rt-itemsno']);
    var rcti = 0;

    if (itemsno > 0) {

        for (var i = 0; i < rt.length; i++) {

            if (rcti >= itemsno || i > 99) { break; }

            var t = rt[i];

            if (rhhistory[t] !== undefined) {

                var title = rhhistory[t].title;
                var url = rhhistory[t].url;
                var time = rhhistory[t].time;
                var furl = getFaviconUrl(rhhistory[t].url);

                if (title == '') {
                    title = url;
                }

                if (title !== undefined) {
                    $('rt-inject').appendChild(formatItem({ type: 'rt', title: title, url: url, favicon: furl, time: time, tabId: t }));
                    rcti++;
                }

            } else {
                console.log("showRecentTabs() tabId = " + t + ", rhhistory undefined");
            }

        }

        if ($$('#rt-inject .item').length == 0) {
            var container = $('rt-inject');
            if (container) { container.style.display = 'none'; }
        }

    }

}


// Most Visited
function mostVisited() {

    var mvc = localStorage['mv-cache'];

    // `undefined` is a cold start: the worker has not written the cache yet.
    // It used to fall through to JSON.parse(undefined) and throw.
    if (mvc !== 'false' && mvc !== undefined) {

        var mvd = JSON.parse(mvc);
        var itemsno = Number(localStorage['mv-itemsno']);
        var mvrl = localStorage['mv-blocklist'];
        var r = 0;

        // Two bounds, not one. MOST_VISITED_MAX is what the worker fills the
        // cache up to; the cache is *shorter* whenever its filters (internal
        // URLs, the 28-day window) dropped entries, and walking past its end
        // used to throw on `mvd[i].title` and abandon the rest of the popup.
        var limit = Math.min(MOST_VISITED_MAX, mvd.length);

        for (var i = 0; i < limit; i++) {

            // Same as recentHistory(): `>=` is the sturdier spelling, not a
            // behavioural fix — `r` also steps by one.
            if (r >= itemsno) {
                break;
            }

            if (mvd[i].title !== undefined) {
                if (mvrl.indexOf(mvd[i].url + '|') == -1) {
                    $('mv-inject').appendChild(formatItem({ type: 'mv', url: mvd[i].url, favicon: mvd[i].favicon, title: mvd[i].title, visits: mvd[i].visitCount }));
                    r++;
                }
            }

        }

    }

}


// Recent Bookmarks
function recentBookmarks() {

    var rbin = Number(localStorage['rb-itemsno']);

    if (rbin > 0) {

        chrome.bookmarks.getRecent(rbin, function (bm) {

            if (bm.length > 0) {

                for (var i = 0; i < bm.length; i++) {

                    if (bm[i] !== undefined) {

                        var title = bm[i].title;
                        var url = bm[i].url;
                        var furl = getFaviconUrl(bm[i].url);

                        if (title == '') {
                            title = url;
                        }

                        $('rb-inject').appendChild(formatItem({ type: 'rb', url: url, title: title, favicon: furl, time: formatDate(bm[i].dateAdded) }));

                    }

                }

            }

        });

    }

}


// Pinned
//
// Read-only now: the pin button that used to sit on every row is gone, so
// `rh-pinned` holds nothing but entries pinned before that, and nothing in the
// extension can add to it. The block still renders them — otherwise they would
// be in storage and nowhere on screen.
function pinned() {

    var pc = localStorage['rh-pinned'];

    // Popup.js only creates #pi-inject when there is something to show, but
    // the block can also be re-rendered from code paths that run before that.
    var holder = $('pi-inject');
    if (!holder) { return; }

    if (pc !== 'false' && pc !== undefined) {

        var pd = JSON.parse(pc);

        for (var i = 0; i < pd.length; i++) {

            if (pd[i] !== undefined) {
                holder.appendChild(formatItem({ type: 'pi', url: pd[i].url, favicon: pd[i].favicon, title: pd[i].title, time: pd[i].time }));
            }

        }

    }

}


// --- Exports ---
export {
    leftClick,
    rightClick,
    formatItem,
    popupSearch,
    alertUser,
    recentHistory,
    recentlyClosedTabs,
    openTab,
    showRecentTabs,
    mostVisited,
    recentBookmarks,
    pinned
};