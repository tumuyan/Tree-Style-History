// Tree Style History - Helper Utilities Module
// Pure utility functions with minimal side effects.

import { defaultValues } from './config.js';

// --- Date/Time ---

var _DATE = new Date();
_DATE.setHours(0); _DATE.setMinutes(0); _DATE.setSeconds(0); _DATE.setMilliseconds(0);
var DAY = 24 * 3600 * 1000;

function TimeToStr(time, skip_date, skip_year, skip_clock) {
    if (new Date() - _DATE > DAY)
        _DATE = _DATE + DAY;
    var tf = localStorage['rh-timeformat'];
    var currentTime = new Date(time);
    var hours = currentTime.getHours();
    var minutes = currentTime.getMinutes();
    if (time == undefined) {
        hours = '--';
        minutes = '--';
    } else {
        if (tf == '12') {
            var te;
            if (hours > 11) {
                te = ' ' + returnLang('PM');
            } else {
                te = ' ' + returnLang('AM');
            }
            if (hours == 0) { hours = 12; }
            if (hours > 12) { hours = hours - 12; }
        } else if (tf == '24') {
            var te = '';
        }
        if (hours < 10) { hours = '0' + hours; }
        if (minutes < 10) { minutes = '0' + minutes; }
        if (time > _DATE.getTime() && skip_date) {
            return hours + ':' + minutes + te;
        }
    }
    var datestr = localStorage['rh-date'];
    if (!datestr || typeof datestr !== 'string') {
        datestr = 'mm/dd/yyyy';
    }
    var month = currentTime.getMonth() + 1;
    if (month < 10) { month = '0' + month; }
    var days = currentTime.getDate();
    if (days < 10) { days = '0' + days; }
    var year = currentTime.getFullYear();
    if (time == undefined) {
        year = '----';
        month = '--';
        days = '--';
    }
    datestr = datestr.replace('dd', days);
    datestr = datestr.replace('mm', month);
    if (skip_year) {
        if (skip_clock) {
            if ((new Date()).getFullYear() != year)
                return datestr.replace('yyyy', year);
        }
        datestr = datestr.replace('yyyy/', '').replace('/yyyy', '');
    } else {
        datestr = datestr.replace('yyyy', currentTime.getFullYear());
    }
    return datestr + ' ' + hours + ':' + minutes + te;
}

function timeNow(st) {
    var tf = localStorage['rh-timeformat'];
    var currentTime = st === 0 ? new Date() : new Date(st);
    var hours = currentTime.getHours();
    var minutes = currentTime.getMinutes();
    var te;
    if (tf == '12') {
        if (hours > 11) { te = ' ' + returnLang('PM'); } else { te = ' ' + returnLang('AM'); }
        if (hours == 0) { hours = 12; }
        if (hours > 12) { hours = hours - 12; }
    } else if (tf == '24') {
        te = '';
    }
    if (hours < 10) { hours = '0' + hours; }
    if (minutes < 10) { minutes = '0' + minutes; }
    return hours + ':' + minutes + te;
}

function formatDate(str) {
    var datestr = localStorage['rh-date'];
    if (str == undefined) {
        datestr = datestr.replace('dd', '--');
        datestr = datestr.replace('mm', '--');
        datestr = datestr.replace('yyyy', '----');
    } else {
        str = Number(str);
        var date = new Date(str);
        var day = date.getDate() + '';
        var month = (date.getMonth() + 1) + '';
        var year = date.getFullYear() + '';
        if (day.length == 1) { day = '0' + day; }
        if (month.length == 1) { month = '0' + month; }
        datestr = datestr.replace('dd', day);
        datestr = datestr.replace('mm', month);
        datestr = datestr.replace('yyyy', year);
    }
    return datestr;
}

// --- i18n ---

function echoLang(str) {
    document.write(chrome.i18n.getMessage(str));
}

function returnLang(str) {
    return chrome.i18n.getMessage(str);
}

// --- String utilities ---

function stripScripts(text) {
    return text.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
}

function title_fix(text) {
    return stripScripts(text).replace(/\"/g, '&#34;').replace(/\</g, '').replace(/\>/g, '').replace(/\//g, '');
}

function escapeHtmlAttr(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function truncate(str, ind, lng) {
    if (str.length > lng) {
        return str.substring(ind, lng) + '...';
    } else {
        return str.substring(ind, lng);
    }
}

function extractFileName(str) {
    return str.substring(str.lastIndexOf('/') + 1);
}

function calcSize(size) {
    if (isNaN(size)) { return '--'; }
    if (size < 1024) { return size + ' b'; }
    if (size < 1048576) { return (size / 1024).toFixed(2) + ' kb'; }
    if (size < 1073741824) { return (size / 1048576).toFixed(2) + ' mb'; }
    return (size / 1073741824).toFixed(2) + ' gb';
}

// --- URL utilities ---

function getUrlVars() {
    var vars = [], hash;
    var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
    for (var i = 0; i < hashes.length; i++) {
        hash = hashes[i].split('=');
        vars.push(hash[0]);
        vars[hash[0]] = hash[1];
    }
    return vars;
}

function isBookmarkletUrl(url) {
    if (typeof url !== 'string') return false;
    return /^javascript\s*:/i.test(url.trim());
}

function extractBookmarkletCode(url) {
    if (!isBookmarkletUrl(url)) return '';
    return url.replace(/^javascript\s*:\s*/i, '');
}

function decodeBookmarkletCode(code) {
    if (!code) return '';
    var decoded = code;
    try { decoded = decodeURIComponent(code); }
    catch (e1) {
        try { decoded = decodeURI(code); }
        catch (e2) { decoded = code; }
    }
    return decoded;
}

function executeBookmarklet(url, options) {
    options = options || {};
    var code = extractBookmarkletCode(url);
    if (!code) { if (options.onFailure) options.onFailure(); return; }
    var scriptToRun = options.decode === false ? code : decodeBookmarkletCode(code);
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs || tabs.length === 0) { if (options.onFailure) options.onFailure(); return; }
        var tabId = tabs[0].id;
        if (chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                func: function (code) {
                    try { (new Function(code))(); }
                    catch (e) { console.error('Bookmarklet execution error:', e); throw e; }
                },
                args: [scriptToRun]
            }, function (results) {
                if (chrome.runtime.lastError) {
                    console.error('Failed to execute bookmarklet:', chrome.runtime.lastError);
                    if (options.onFailure) options.onFailure(chrome.runtime.lastError);
                } else { if (options.onSuccess) options.onSuccess(); }
            });
        } else if (chrome.tabs && chrome.tabs.executeScript) {
            chrome.tabs.executeScript(tabId, { code: scriptToRun }, function () {
                if (chrome.runtime.lastError) {
                    console.error('Failed to execute bookmarklet:', chrome.runtime.lastError);
                    if (options.onFailure) options.onFailure(chrome.runtime.lastError);
                } else { if (options.onSuccess) options.onSuccess(); }
            });
        } else {
            console.error('No available API to execute bookmarklet');
            if (options.onFailure) options.onFailure(new Error('No available API to execute scripts'));
        }
    });
}

// --- Chrome utilities ---

function chromeURL(url) {
    chrome.tabs.create({ url: url, selected: true });
}

function getVersion() {
    return chrome.runtime.getManifest().version;
}

function getVersionType() {
    return 'browserAction';
}

// --- Clipboard ---

var Clipboard = {};
Clipboard.utilities = {};
Clipboard.utilities.createTextArea = function (value) {
    var txt = document.createElement('textarea');
    txt.style.position = "absolute";
    txt.style.left = "-100%";
    if (value != null) txt.value = value;
    document.body.appendChild(txt);
    return txt;
};
Clipboard.copy = function (data) {
    if (data == null) return;
    var txt = Clipboard.utilities.createTextArea(data);
    txt.select();
    document.execCommand('Copy');
    document.body.removeChild(txt);
    return false;
};

// --- Popup scrollbar ---

function popup_scrollbar_fix() {
    var ps = document.body.offsetHeight;
    var pss = document.body.scrollHeight;
    if (pss > ps) {
        var popupEl = document.getElementById('popup');
        if (popupEl) popupEl.style.marginRight = '24px';
    } else {
        var popupEl = document.getElementById('popup');
        if (popupEl) popupEl.style.marginRight = '5px';
    }
}

// --- URL parsing ---

function get_host(url) {
    try {
        var parsed = new URL(url);
        var host = parsed.hostname;
        if (host) return host;
    } catch (e) {
        try {
            var parsed = new URL('https://' + url);
            var host = parsed.hostname;
            if (host && host.indexOf('.') !== -1) return host;
        } catch (e2) {}
    }
    return "#";
}

function getFaviconUrl(url, options) {
    options = options || {};
    if (!url || typeof url !== 'string') {
        return options.hasOwnProperty('fallback') ? options.fallback : '';
    }
    if (isBookmarkletUrl(url)) {
        return options.hasOwnProperty('bookmarkletFallback') ? options.bookmarkletFallback : 'images/iconmonstr-script-6.svg';
    }
    if (url.indexOf('extension://') !== -1 || url.indexOf('edge://extensions') !== -1) {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                return url.indexOf(chrome.runtime.id) !== -1 ? 'images/tree-38.png' : 'images/Extension-icon-vector-04.svg';
            }
        } catch (e) {}
        return 'images/Extension-icon-vector-04.svg';
    }
    if (url.indexOf('chrome://') === 0 || url.indexOf('about:') === 0 || url.indexOf('edge://') === 0 || url.indexOf('opera://') === 0 || url.indexOf('brave://') === 0) {
        return 'images/Browser-icon-vector-03.svg';
    }
    if (url.indexOf('file://') === 0) {
        return 'images/iconmonstr-file-3.svg';
    }
    var service = options.service || localStorage['favicon-service'] || defaultValues['favicon-service'];
    var trimmedUrl = url.trim();
    if (!trimmedUrl) return options.hasOwnProperty('fallback') ? options.fallback : '';
    var hostValue = '#';
    try { hostValue = get_host(trimmedUrl); } catch (err) { hostValue = '#'; }
    if (service === 'chrome') {
        return hostValue === '#' ? 'chrome://favicon/' : 'chrome://favicon/' + trimmedUrl;
    }
    var parsedUrl = null;
    try { parsedUrl = new URL(trimmedUrl); }
    catch (err) {
        try { parsedUrl = new URL('https://' + trimmedUrl); }
        catch (err2) { parsedUrl = null; }
    }
    var fallback = options.hasOwnProperty('fallback') ? options.fallback : 'images/blank.png';
    if (!parsedUrl || hostValue === '#') return fallback;
    var protocol = parsedUrl.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return fallback;
    var hostname = parsedUrl.hostname;
    if (!hostname) return fallback;
    if (service === 'google') return 'https://www.google.com/s2/favicons?sz=64&domain_url=' + encodeURIComponent(parsedUrl.origin + '/');
    if (service === 'duckduckgo') return 'https://icons.duckduckgo.com/ip3/' + hostname + '.ico';
    if (service === 'favicon_im') return 'https://favicon.im/' + hostname;
    if (service === 'faviconkit') return 'https://ico.faviconkit.net/favicon/' + hostname + '?sz=64';
    if (service === 'faviconsnap') return 'https://faviconsnap.com/api/favicon?url=' + encodeURIComponent(parsedUrl.origin + '/') + '&size=64';
    return 'chrome://favicon/' + trimmedUrl;
}

// Get fallback favicon URL for CSP-compliant error handling via addEventListener
function getFaviconOnerror(url) {
    var fallbackService = localStorage['favicon-service-fallback'] || '';
    if (!fallbackService) return '';
    return getFaviconUrl(url, { service: fallbackService });
}

// Setup favicon image element with error and load-based fallback detection
// Some services (e.g. Google) return a default 16x16 icon with HTTP 404 status.
// The <img> 'error' event does NOT fire for valid image data even with 404,
// so we also check the 'load' event and detect suspiciously small icons.
function setupFaviconElement(imgEl, primaryUrl, fallbackUrl) {
    if (!imgEl) return;
    var _checked = false;
    var _retryCount = 0;
    
    imgEl.addEventListener('error', function () {
        _retryCount++;
        // Only attempt fallback once; subsequent errors just show blank
        if (_retryCount === 1 && fallbackUrl) {
            this.src = fallbackUrl;
        } else {
            this.src = 'images/blank.png';
        }
    });
    
    imgEl.addEventListener('load', function () {
        if (_checked) return;
        _checked = true;
        // Google's default 404 icon is 16x16; most real favicons are >= 32x32
        // If the loaded image is suspiciously small, treat as failure
        if (this.naturalWidth <= 16 && this.naturalHeight <= 16 && fallbackUrl) {
            this.src = fallbackUrl;
        }
    });
    
    if (primaryUrl) {
        imgEl.src = primaryUrl;
    }
}

// --- Exports ---
export {
    _DATE, DAY,
    TimeToStr, timeNow, formatDate,
    echoLang, returnLang,
    stripScripts, title_fix, escapeHtmlAttr, truncate, extractFileName, calcSize,
    getUrlVars, isBookmarkletUrl, extractBookmarkletCode, decodeBookmarkletCode, executeBookmarklet,
    chromeURL, getVersion, getVersionType,
    Clipboard,
    popup_scrollbar_fix,
    get_host, getFaviconUrl, getFaviconOnerror, setupFaviconElement
};