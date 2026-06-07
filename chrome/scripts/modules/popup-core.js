import { $, $$, createElement } from '../dom-helper.js';
import {
    returnLang, escapeHtmlAttr, title_fix, timeNow, formatDate,
    getFaviconUrl, isBookmarkletUrl, get_host, executeBookmarklet,
    getFaviconOnerror, setupFaviconElement,
    Clipboard, getVersion, getVersionType
} from './helpers.js';
import { filtUrl, updateFilter } from './config.js';

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
                if (window.ctrlState != 'true' && (localStorage['rh-click'] === 'newtab' || localStorage['rh-click'] === 'current')) {
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
    var cs = window.ctrlState;
    if (cs == 'true' || (event && event.button == 1)) {
        chrome.tabs.create({
            url: url,
            selected: false
        });
    } else {
        if (ca == 'current') {
            chrome.tabs.getSelected(null, function (tab) {
                chrome.tabs.update(tab.id, { url: url }, function () {
                    window.close();
                });
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
    var rhssbg = localStorage['rhs-showbg'];

    var url = data.url;
    var type = data.type;
    var title = title_fix(data.title);
    var favicon = data.favicon;
    var time = data.time;

    if (data.visits !== undefined) {
        var visits = data.visits;
    } else {
        var visits = '';
    }

    if (rhsurl == 'yes' || rhsext == 'yes') {
        var saext = 'style="margin-left: 2px;"';
    } else {
        var saext = '';
    }

    if (rhsext == 'no') {
        var sext = 'style="display:none;"';
    } else {
        if (type == 'rh' || type == 'mv') {
            var sext = '';
        } else {
            var sext = 'style="display:none;"';
        }
    }

    if (rhsurl == 'no') {
        var surl = 'style="display:none;"';
    } else {
        var surl = '';
    }

    if (localStorage['rhs-showsep'] == 'yes') {
        sobj['border-bottom'] = '1px solid #ccc';
    }

    if (rhsext == 'yes' && rhsurl == 'yes') {
        var extsep = ' | ';
    } else {
        var extsep = '';
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

    if (type !== 'pi') {
        var ui = '<span class="ui-pin" data-function="' + type + '">&nbsp;</span><span class="ui-delete" data-function="' + type + '">&nbsp;</span>';
    } else {
        var ui = '<span class="ui-delete" data-function="' + type + '">&nbsp;</span>';
    }

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
        } catch (e) {
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

    item += '<span class="title" title="' + escapeHtmlAttr(tip) + '"><span class="edit-items-ui" data-url="' + escapeHtmlAttr(url) + '" data-title="' + escapeHtmlAttr(tip) + '">' + ui + '</span>' + title + '</span>';

    // For bookmarklets, show simplified URL in the extra-url section
    var urlDisplay = isBookmarkletUrl(url) ? 'javascript:...' : url.replace(/^(.*?)\:\/\//, '').replace(/\/$/, '');
    item += '<span ' + saext + ' class="extra-url"><span ' + sext + ' class="extra">' + returnLang("visits") + ': ' + visits + extsep + '</span><span ' + surl + ' class="url">' + escapeHtmlAttr(urlDisplay) + '</span></span>';



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
                for (var i = 0; i <= hi.length; i++) {
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
                if (localStorage['rhs-showbg'] == 'yes') {
                    //isBookmarked('#popup-search-insert ');
                    isPinned('#popup-search-insert ');
                }
            } else {
                $('popup-search-insert').innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
            }
        });
    }
}


// Is bookmarked
function isBookmarked(w) {
    Array.from($$(w)).forEach(function (el) {
        chrome.bookmarks.search(el.href, function (bms) {
            if (bms.length > 0) {
                for (var i in bms) {
                    if (bms[i].url == el.href) {
                        if (w == '#rh-views .item .link') {
                            var bookmarkSpan = el.closest('div.item').querySelector('span.bookmark');
                            if (bookmarkSpan) {
                                bookmarkSpan.style.backgroundImage = 'url("images/star.png")';
                            }
                        } else {
                            if (el.style.backgroundColor !== '#ffffbd') {
                                el.style.backgroundColor = '#ffffbd';
                            }
                        }
                    }
                }
            }
        });
    });
}


// Is pinned
function isPinned(w) {
    Array.from($$(w)).forEach(function (el) {
        var pi = JSON.parse(localStorage['rh-pinned']);
        if (pi.length > 0) {
            for (var i in pi) {
                if (pi[i] !== undefined) {
                    if (pi[i].url == el.href) {
                        if (w == '#rh-views .item .link') {
                            var pinSpan = el.closest('div.item').querySelector('span.pin');
                            if (pinSpan) {
                                pinSpan.style.backgroundImage = 'url("images/pin.png")';
                            }
                        } else {
                            if (el.style.backgroundColor !== '#f0fff1') {
                                el.style.backgroundColor = '#f0fff1';
                            }
                        }
                    }
                }
            }
        }
    });
}


// UI Edit items
function uiEditItems(type) {
    var editItems = $$('#' + type + '-inject .edit-items-ui');
    if (editItems.length > 0) {
        if (editItems[0].style.display == 'none') {
            Array.from(editItems).forEach(function (el) {
                el.style.display = 'inline';
            });
        } else if (editItems[0].style.display == 'inline') {
            Array.from(editItems).forEach(function (el) {
                el.style.display = 'none';
            });
        }
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


// UI Pin item
function uiPinItem(el, type) {
    alertUser(returnLang('ui1'), 'open');
    $('alert-no').addEventListener('click', function () {
        alertUser('', 'close');
    });
    $('alert-yes').addEventListener('click', function () {
        var url = el.closest('a').href;
        var title = Array.from(el.closest('a').querySelectorAll(':scope > span.title'))[0].textContent.trim();
        var furl = el.closest('a').querySelectorAll('img')[0].src;
        var time = timeNow(0);
        var pi = localStorage['rh-pinned'];
        if (pi.indexOf('"' + url + '"') == -1) {
            if (pi == 'false') {
                localStorage['rh-pinned'] = JSON.stringify([{ url: url, title: title, favicon: furl, time: time }]);
                $('pi-inject').style.display = 'inline';
                if (type == 'rh') {
                    Array.from($$('#rh-inject .item')).forEach(function (item) { item.remove(); });
                    recentHistory();
                } else if (type == 'rct') {
                    Array.from($$('#rct-inject .item')).forEach(function (item) { item.remove(); });
                    recentlyClosedTabs();
                } else if (type == 'rt') {
                    Array.from($$('#rt-inject .item')).forEach(function (item) { item.remove(); });
                    showRecentTabs();
                } else if (type == 'rb') {
                    Array.from($$('#rb-inject .item')).forEach(function (item) { item.remove(); });
                    recentBookmarks();
                } else if (type == 'mv') {
                    Array.from($$('#mv-inject .item')).forEach(function (item) { item.remove(); });
                    mostVisited();
                }
                pinned();
                alertUser('', 'close');
            } else {
                pi = JSON.parse(pi);
                pi.unshift({ url: url, title: title, favicon: furl, time: time });
                localStorage['rh-pinned'] = JSON.stringify(pi);
                if (type == 'rh') {
                    Array.from($$('#rh-inject .item')).forEach(function (item) { item.remove(); });
                    recentHistory();
                } else if (type == 'rct') {
                    Array.from($$('#rct-inject .item')).forEach(function (item) { item.remove(); });
                    recentlyClosedTabs();
                } else if (type == 'rt') {
                    Array.from($$('#rt-inject .item')).forEach(function (item) { item.remove(); });
                    showRecentTabs();
                } else if (type == 'rb') {
                    Array.from($$('#rb-inject .item')).forEach(function (item) { item.remove(); });
                    recentBookmarks();
                } else if (type == 'mv') {
                    Array.from($$('#mv-inject .item')).forEach(function (item) { item.remove(); });
                    mostVisited();
                }
                Array.from($$('#pi-inject .item')).forEach(function (item) { item.remove(); });
                pinned();
                alertUser('', 'close');
            }
        }
    });
}


// UI Delete item
function uiDeleteItem(el, type) {
    if (type == 'rh') {
        alertUser(returnLang('ui2'), 'open');
    } else if (type == 'rct') {
        alertUser(returnLang('ui3'), 'open');
    } else if (type == 'rb') {
        alertUser(returnLang('ui4'), 'open');
    } else if (type == 'mv') {
        alertUser(returnLang('ui5'), 'open');
    } else if (type == 'pi') {
        alertUser(returnLang('ui6'), 'open');
    }
    $('alert-yes').addEventListener('click', function () {
        var url = el.closest('a').href;
        if (type == 'rh') {
            chrome.history.deleteUrl({ url: url });
            Array.from($$('#rh-inject .item')).forEach(function (item) { item.remove(); });
            recentHistory();
            alertUser('', 'close');
        } else if (type == 'rct') {
            console.warn('Removing recently closed entries is not supported.');
            alertUser('', 'close');
        } else if (type == 'rt') {
            console.log("//todo uiDeleteItem");
        } else if (type == 'rb') {
            chrome.bookmarks.search(url, function (bms) {
                if (bms.length > 0) {
                    for (var i in bms) {
                        if (bms[i].url == url) {
                            chrome.bookmarks.remove(bms[i].id, function () {
                                Array.from($$('#rb-inject .item')).forEach(function (item) { item.remove(); });
                                recentBookmarks();
                                Array.from($$('#popup-insert .item')).forEach(function (item) { item.style.backgroundColor = 'transparent'; });
                                //isBookmarked('#rh-inject .item');
                                isPinned('#rh-inject .item');
                                //isBookmarked('#rct-inject .item');
                                isPinned('#rct-inject .item');
                                if ($$('#rb-inject .item').length == 0) {
                                    $('rb-inject').style.display = 'none';
                                }
                                alertUser('', 'close');
                            });
                        }
                    }
                }
            });
        } else if (type == 'mv') {
            var mv = localStorage['mv-blocklist'];
            if (mv == 'false') {
                localStorage['mv-blocklist'] = url + '|';
            } else {
                localStorage['mv-blocklist'] = localStorage['mv-blocklist'] + url + '|';
            }
            Array.from($$('#mv-inject .item')).forEach(function (item) { item.remove(); });
            mostVisited();
            alertUser('', 'close');
        } else if (type == 'pi') {
            var pi = JSON.parse(localStorage['rh-pinned']);
            var pl = pi.length;
            if (pl > 0) {
                for (var i in pi) {
                    if (pi[i] !== undefined) {
                        if (pi[i].url == url) {
                            pi.splice(i, 1);
                            if (pl == 1) {
                                localStorage['rh-pinned'] = 'false';
                            } else {
                                localStorage['rh-pinned'] = JSON.stringify(pi);
                            }
                            Array.from($$('#pi-inject .item')).forEach(function (item) { item.remove(); });
                            pinned();
                            if ($$('#pi-inject .item').length == 0) {
                                $('pi-inject').style.display = 'none';
                            }
                            Array.from($$('#popup-insert .item')).forEach(function (item) { item.style.backgroundColor = 'transparent'; });
                            //isBookmarked('#rh-inject .item');
                            isPinned('#rh-inject .item');
                            //isBookmarked('#rct-inject .item');
                            isPinned('#rct-inject .item');
                            alertUser('', 'close');
                        }
                    }
                }
            }
        }
    });
    $('alert-no').addEventListener('click', function () {
        alertUser('', 'close');
    });
}


// Recent History
function recentHistory() {

    var ir = 0;
    var rh = '';
    var rhin = Number(localStorage['rh-itemsno']);
    var rhino = rhin;
    rhin = rhin * 4;

    if (rhin > 0) {

        chrome.history.search({ text: '', maxResults: rhin, startTime: (new Date()).getTime() - (28 * 24 * 3600 * 1000), endTime: (new Date()).getTime() }, function (hi) {

            if (hi.length > 0) {

                for (var i = 0; i <= hi.length; i++) {

                    if (ir == rhino) { break; }

                    if (hi[i] !== undefined) {

                        var title = hi[i].title;
                        var url = hi[i].url;
                        var visits = hi[i].visitCount;
                        var furl = getFaviconUrl(hi[i].url);
                        var test = (/^(file|chrome|chrome-extension|chrome-devtools)\:\/\//).test(url);

                        if (title == '') {
                            title = url;
                        }

                        if (filtUrl(url) == false) {
                            $('rh-inject').appendChild(formatItem({ type: 'rh', title: title, url: url, favicon: furl, visits: visits, time: timeNow(hi[i].lastVisitTime) }));
                            ir++;
                        }
                    }

                }

                if (localStorage['rhs-showbg'] == 'yes') {
                    //isBookmarked('#rh-inject .item');
                    isPinned('#rh-inject .item');
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

            if (localStorage['rhs-showbg'] == 'yes') {
                //isBookmarked('#rct-inject .item');
                isPinned('#rct-inject .item');
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


// Recent Tabs in popup
function showRecentTabs(rhhistory, rt) {
    if (rhhistory !== undefined && rt !== undefined) {
        // Data provided directly, skip message passing
        showRecentTabsImpl(rhhistory, rt);
        return;
    }
    if (typeof window.messageAdapter !== 'undefined') {
        Promise.all([
            window.messageAdapter.getBackgroundData('openedTabs'),
            window.messageAdapter.getBackgroundData('recentTabs')
        ]).then(([rhhistory, rt]) => {
            showRecentTabsImpl(rhhistory, rt);
        }).catch(err => {
            console.error('Failed to get tab data:', err);
            var el = $('rt-inject');
            if (el) el.style.display = 'none';
        });
    } else {
        var rhhistory = chrome.extension.getBackgroundPage().openedTabs;
        var rt = chrome.extension.getBackgroundPage().recentTabs;
        showRecentTabsImpl(rhhistory, rt);
    }
}

function showRecentTabsImpl(rhhistory, rt) {
    rhhistory = rhhistory || {};
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
            $('rt-inject').style.display = 'none';
        }

        if (localStorage['rhs-showbg'] == 'yes') {
            //isBookmarked('#rct-inject .item');
            isPinned('#rt-inject .item');
        }


    }

}


// Most Visited
function mostVisited() {

    var mvc = localStorage['mv-cache'];

    if (mvc !== 'false') {

        var mvd = JSON.parse(mvc);
        var itemsno = Number(localStorage['mv-itemsno']);
        var mvrl = localStorage['mv-blocklist'];
        var r = 0;

        for (var i = 0; i < 45; i++) {

            if (r == itemsno) {
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

                for (var i = 0; i <= bm.length; i++) {

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
function pinned() {

    var pc = localStorage['rh-pinned'];

    if (pc !== 'false') {

        var pd = JSON.parse(pc);

        for (var i = 0; i < 99; i++) {

            if (pd[i] !== undefined) {
                $('pi-inject').appendChild(formatItem({ type: 'pi', url: pd[i].url, favicon: pd[i].favicon, title: pd[i].title, time: pd[i].time }));
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
    isBookmarked,
    isPinned,
    uiEditItems,
    alertUser,
    uiPinItem,
    uiDeleteItem,
    recentHistory,
    recentlyClosedTabs,
    openTab,
    showRecentTabs,
    showRecentTabsImpl,
    mostVisited,
    recentBookmarks,
    pinned
};