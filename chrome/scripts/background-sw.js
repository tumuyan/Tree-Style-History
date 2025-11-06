// Service Worker for Tree Style History (Manifest V3)
// This replaces background.html/background.js for MV3 compatibility

// Import modules
importScripts('storage-adapter.js');
importScripts('background-utils.js');
importScripts('db-manager.js');

// Set global vars
var openedTabs = {};
var recentTabs = [];

// Session data (will be persisted to storage due to SW lifecycle)
var oid;
var DAY = 24 * 3600 * 1000;
var date = new Date();
date.setHours(23); date.setMinutes(59); date.setSeconds(59); date.setMilliseconds(999);

var calendar_str;
var calendar = {};
var calendar_r = {};

var MAX = Number.MAX_VALUE - 1;
var urls_wait_load = new Array();

// Tab tracking data
var openerJson = {};
var tabUrlJson = {};
var tabUrl0Json = {};
var urlIdJson = {};
var idUrlJson = {};

console.log("Service Worker loading...");

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

// Initialize storage and DB when service worker starts
onStorageReady(function () {
    initializeStorageState();
});

function initializeStorageState() {
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
    
    // Set up alarm for periodic updates (instead of setInterval)
    chrome.alarms.create('mostVisited', { periodInMinutes: 3 });
    
    // Initialize DB
    dbManager.init().then(() => {
        console.log('DB ready in service worker');
        dbManager.updateClosedTabsStatus();
        loadDate(date.getTime(), 0);
    }).catch(error => {
        console.error('Failed to initialize DB:', error);
    });
    
    // Initialize context menu
    initContextMenu();
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
    addCloseRedord(tab.id, tab.url, tab.title, 0, -1);
}

// Closed tab
function closedTab(id) {
    if (openedTabs[id] !== undefined) {
        console.log('close ' + id + ' ' + openedTabs[id].url);
        addCloseRedord(id, openedTabs[id].url, openedTabs[id].title, (new Date()).getTime(), 0);
        openedTabs[id].time = timeNow(0);

        var i = recentTabs.indexOf(id);
        if (i >= 0) {
            recentTabs.splice(i, 1);
        }
    }
}

// Add close record
function addCloseRedord(tid, url, title, time, close) {
    if ((/^(http|https)\:\/\/(.*)/).test(url) && url != title && title != '') {
        dbManager.putClosedTab({
            id: oid + '_' + tid,
            oid: oid - 1,
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
                addCloseRedord(tab.id, tab.url, tab.title, 0, -2);
            }
            openedTabs[tab.id].title = tab.title;
            openedTabs[tab.id].url = tab.url;
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
                        (/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(hi[i].url) == false) {
                        
                        var currentTime = new Date(hi[i].lastVisitTime);
                        var hours = currentTime.getHours();
                        var minutes = currentTime.getMinutes();
                        if (hours < 10) { hours = '0' + hours; }
                        if (minutes < 10) { minutes = '0' + minutes; }
                        var time = hours + ':' + minutes;

                        var title = hi[i].title;
                        var url = hi[i].url;
                        var furl = 'chrome://favicon/' + hi[i].url;

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
                console.log("chrome.tabs.onCreated " + tab.openerTabId + " -> " + tab.id + "; " + 
                    openerJson[tab.id.toString()] + " -> " + tab.url + ";");
            }
        }
    }
});

var tabActive = 0;

chrome.tabs.onUpdated.addListener(function (id, info, tab) {
    if (tabUrlJson[id.toString()] != tab.url) {
        if (tabUrlJson[id.toString()] != undefined)
            tabUrl0Json[id.toString()] = tabUrlJson[id.toString()];
        tabUrlJson[id.toString()] = tab.url;
    }

    if (info.status == "complete") {
        console.log("chrome.tabs.onUpdated v " + tab.openerTabId + " -> " + tab.id + "; " + 
            openerJson[tab.id.toString()] + " -> " + tab.url + "; title=" + tab.title);
        visitTab(tab);
    }

    updatedTab(tab);

    if (getVersionType() == 'pageAction') {
        chrome.pageAction.show(id);
    }
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
    var i = recentTabs.indexOf(activeInfo.tabId);
    if (i >= 0) {
        recentTabs.splice(i, 1);
    }
    recentTabs.unshift(activeInfo.tabId);
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

// Load date function
function loadDate(date, dateId) {
    if (dateId > localStorage['load-range']) {
        console.log("loadDate done. dateId = " + dateId + ">" + localStorage['load-range']);
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
        console.log("skip dday=" + dday + ":" + calendar[dday] + " qday=" + qday + ":" + calendar[qday]);
        add_urls([], date, dateId, 0);
    } else {
        console.log("load dday=" + dday + ":" + calendar[dday] + " qday=" + qday + ":" + calendar[qday]);
        let obj = { text: '', maxResults: 0, startTime: date - (24 * 3600 * 1000), endTime: date };
        chrome.history.search(obj, function (hi) {
            if (hi.length > 0) {
                hi.sort(function (a, b) { return b.visitCount - a.visitCount });
                save_calendar_storage2(obj, hi.length, false);
            }
            add_urls(hi, date, dateId, 0);
        });
    }
}

// Add URLs function
function add_urls(urls, date_ms, dateId, i) {
    let h_len = urls.length;

    if (i >= h_len) {
        if (h_len < 1)
            console.log("dateId=" + dateId + " loadDate(" + (new Date(date_ms)).toString() + ") no data");
        else
            console.log("dateId=" + dateId + " loadDate(" + (new Date(date_ms)).toString() + ") done");
        loadDate(date_ms - DAY, dateId + 1);
    } else if (urls[i] != undefined) {
        if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(urls[i].title) == false && 
            (/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(urls[i].url) == false) {
            
            var title = urls[i].title;
            var url = urls[i].url;

            if (title == '') {
                title = url;
            }

            dbManager.putURL({
                id: urls[i].id,
                url: url,
                lastVisitTime: urls[i].lastVisitTime,
                visitCount: urls[i].visitCount,
                title: title
            }).then(() => {
                add_urls(urls, date_ms, dateId, i + 1);
            }).catch(error => {
                console.log("add_url Error :( " + url, error);
                add_urls(urls, date_ms, dateId, i + 1);
            });
        } else {
            add_urls(urls, date_ms, dateId, i + 1);
        }
    }
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
        getVisits(0);
    }).catch(error => {
        console.error('loadHistory() Error:', error);
    });
}

// Get visits function
function getVisits(urls_p) {
    if (urls_p >= MAX) {
        console.log("visitTab done.");
        return;
    }
    if (urls_p >= urls_wait_load.length) {
        chrome.action.setBadgeText({ text: "" });
        console.log("getVisits done.");
        return;
    }
    chrome.action.setBadgeText({ text: (urls_wait_load.length - urls_p).toString() });

    let url_item = urls_wait_load[urls_p];
    let details = { url: url_item.url };
    chrome.history.getVisits(details, function (h) {
        let h_len = h.length;
        if (h_len < 1) {
            console.log("getVisits() no data, url=" + details.url);
            getVisits(urls_p + 1);
        } else {
            h.sort(function (a, b) { return b.visitTime - a.visitTime });
            let loadfrom = (new Date()).getTime() - DAY * localStorage["load-range"];
            add_history(urls_p, 0, h, loadfrom, url_item);
        }
    });
}

// Add history function
function add_history(urls_p, i, visitItems, loadfrom, url_item) {
    if (visitItems.length > i) {
        let visitTime = visitItems[i].visitTime;
        let visitId = visitItems[i].visitId;
        let refer = visitItems[i].referringVisitId;
        let transition = visitItems[i].transition;

        if (transition == "typed" || transition == "auto_bookmark" || 
            transition == "keyword" || transition == "keyword_generated") {
            console.log("change refer " + visitItems[i].referringVisitId + "->0 cause transition=" + transition);
            refer = 0;
        }

        if (refer == undefined) refer = 0;

        if (visitTime < loadfrom) {
            console.log("add_history() time=" + visitTime + " < " + loadfrom + ", url=" + url_item.url);
            update_urls(url_item, loadfrom, visitItems[0].visitTime, urls_p);
            return;
        }

        dbManager.putVisitItem({
            visitId: visitId,
            referringVisitId: refer,
            url: url_item.url,
            visitTime: visitTime,
            title: url_item.title,
            transition: transition,
        }).then(() => {
            console.log("Success :) " + refer + " -> " + visitId + " [" + url_item.visitCount + "] " + url_item.url);
            add_history(urls_p, i + 1, visitItems, loadfrom, url_item);
        }).catch(error => {
            console.log("Error :( [" + visitId + "] " + url_item.url, error);
            add_history(urls_p, i + 1, visitItems, loadfrom, url_item);
        });
    } else {
        update_urls(url_item, loadfrom, visitItems[0].visitTime, urls_p);
    }
}

// Update URLs function
function update_urls(u, loadfrom, loadto, urls_p) {
    u.loadfrom = loadfrom;
    u.loadto = loadto;
    
    dbManager.putURL(u).then(() => {
        getVisits(urls_p + 1);
    }).catch(error => {
        console.error("update_urls Error :(", error);
        getVisits(urls_p + 1);
    });
}

// Visit tab function
function visitTab(tab) {
    let url = tab.url;

    if (url == undefined || url == "") return;

    console.log("visitTab() tabId=" + tab.openerTabId + " -> " + tab.id + " url=" + url);

    if ((/^(http|https|ftp|ftps|file|chrome|chrome-extension|chrome-devtools)\:\/\/(.*)/).test(tab.title) == false && 
        (/^(ftp|ftps|file|chrome|chrome-extension)\:\/\/(.*)/).test(tab.url) == false) {
        
        let now = new Date();
        if (new Date() - date > DAY)
            date = date + DAY;

        let details = { url: tab.url };
        chrome.history.getVisits(details, function (h) {
            let h_len = h.length;
            if (h_len < 1) {
                console.log("visitTab(" + tab.id + ") no data, url=" + tab.url);
            } else {
                h.sort(function (a, b) { return b.visitTime - a.visitTime });
                let loadfrom = (new Date()).getTime() - 1000000;
                add_tab_history(h, 0, loadfrom, { id: tab.id, url: tab.url, title: tab.title, lastVisitTime: now });
            }
        });
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
            console.log("[Err] add_tab_history() time=" + visitTime + " < " + loadfrom + ", url=" + url_item.url);
            return;
        }

        if (idUrlJson[visitId.toString()] == undefined) {
            urlIdJson[url_item.url] = visitId;
            idUrlJson[visitId.toString()] = url_item.url;
            console.log("visitJson " + refer + "->" + visitId + " transition=" + transition + " " + url_item.url);
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
            console.log("change refer " + visitItems[i].referringVisitId + "->0 cause transition=" + transition);
            refer = 0;
        }

        console.log("refer referringVisitId/refer2/tabUrl0/result=" + visitItems[i].referringVisitId + "/" + 
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
        console.log("add_tab_history() no_result ");
    }
}

console.log("Service Worker loaded");
