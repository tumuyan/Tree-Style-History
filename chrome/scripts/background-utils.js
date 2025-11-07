// Background Utilities
// Extracted minimal functions needed by background script
// This separates background dependencies from UI dependencies for MV3 migration

// Version

function getVersion() {
    return '3.1.13';
}


// Version Type

function getVersionType() {
    return 'browserAction';
}


// Return lang

function returnLang(str) {
    return chrome.i18n.getMessage(str);
}


// Get favicon URL with configurable service
function getFaviconUrl(url) {
    if (!url) {
        return 'images/blank.png';
    }

    var faviconApi = localStorage['favicon-api'] || 'chrome';
    var parsedUrl = null;

    try {
        parsedUrl = new URL(url);
    } catch (e) {
        parsedUrl = null;
    }

    var protocol = parsedUrl ? parsedUrl.protocol : '';
    var hostname = parsedUrl ? parsedUrl.hostname : '';
    var isHttpLike = /^https?:$/i.test(protocol);

    if (faviconApi === 'chrome' || !isHttpLike || !hostname) {
        return 'chrome://favicon/' + url;
    }

    if (faviconApi === 'google') {
        return 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32';
    }

    if (faviconApi === 'duckduckgo') {
        return 'https://icons.duckduckgo.com/ip3/' + hostname + '.ico';
    }

    if (faviconApi === 'yandex') {
        return 'https://favicon.yandex.net/favicon/' + hostname;
    }

    if (faviconApi === 'iconhorse') {
        return 'https://icon.horse/icon/' + hostname;
    }

    return 'chrome://favicon/' + url;
}


// Time formatting

function timeNow(st) {
    var tf = localStorage['rh-timeformat'];
    var currentTime = st === 0 ? new Date() : new Date(st);
    var hours = currentTime.getHours() * 1;
    var minutes = currentTime.getMinutes() * 1;
    var te = '';

    if (tf == '12') {
        if (hours > 11) {
            te = ' ' + returnLang('PM');
        } else {
            te = ' ' + returnLang('AM');
        }
        if (hours == 0) {
            hours = 12;
        }
        if (hours > 12) {
            hours = hours - 12;
        }
    }

    if (hours < 10) {
        hours = '0' + hours;
    }
    if (minutes < 10) {
        minutes = '0' + minutes;
    }

    return hours + ':' + minutes + te;
}


// Calendar storage helper

var _DATE = new Date();
_DATE.setHours(0); _DATE.setMinutes(0); _DATE.setSeconds(0); _DATE.setMilliseconds(0);
var DAY = 24 * 3600 * 1000;

var calendar_storage2 = {};
onStorageReady(function() {
    var calendar_storage2_str = localStorage['calendar-storage2'];
    if (calendar_storage2_str != undefined) {
        try {
            calendar_storage2 = JSON.parse(calendar_storage2_str);
        } catch (error) {
            console.warn('Failed to parse calendar-storage2', error);
            calendar_storage2 = {};
        }
    }
});

function save_calendar_storage2(obj, n, f) {
    if (obj['text'] == '' && obj['maxResults'] >= 9999 && obj['endTime'] - 86400000 == obj['startTime']) {
        if ((obj['startTime'] - _DATE + 1) % 86400000 == 0) {
            if (f || calendar_storage2[obj['startTime']] == undefined || calendar_storage2[obj['startTime']] < 1) {
                calendar_storage2[obj['startTime']] = n;
                console.log('n=' + n);
                localStorage['calendar-storage2'] = JSON.stringify(calendar_storage2);
            }
        }
    }
}


// Default configuration values

var defaultValues = {
    "rh-itemsno": 16,
    "rct-itemsno": 4,
    "rt-itemsno": 6,
    "mv-itemsno": 0,
    "rb-itemsno": 3,
    "mv-blocklist": "false",
    "rh-historypage": "yes",
    "rh-date": "mm/dd/yyyy",
    "rh-width": "275px",
    "load-range": 7,
    "load-range2": 3,
    "load-range3": 120,
    "load-range4": 150,
    "less-item": "no",
    "rh-search": "yes",
    "rh-list-order": "rh-order,rct-order,rb-order,mv-order,rt-order",
    "rh-time": "yes",
    "rh-group": "yes",
    "rh-orderby": "date",
    "rh-order": "desc",
    "rh-timeformat": "24",
    "rh-click": "newtab",
    "rm-click": "default",
    "rm-path": "yes",
    'use-contextmenu': "yes",
    "rh-share": "yes",
    "rh-filtered": "false",
    "rh-pinned": "false",
    "rhs-showurl": "no",
    "rhs-showsep": "no",
    "rhs-showext": "no",
    "rhs-showbg": "no",
    "show-popup": "yes",
    "favicon-api": "chrome"
};

function defaultConfig(clean) {
    for (var v in defaultValues) {
        if (clean || !localStorage[v] || localStorage[v] == null || localStorage[v] == '') {
            localStorage[v] = defaultValues[v];
        }
    }
}
