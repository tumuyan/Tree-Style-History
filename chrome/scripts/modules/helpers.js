// Tree Style History - Helper Utilities Module
// Pure utility functions with minimal side effects.
//
// The functions that must also run inside the Service Worker live in
// `modules/shared/` — the dependency-free bottom layer that
// `scripts/gen-sw-utils.mjs` mechanically flattens into
// `scripts/background-utils.js`. They are imported for internal use and
// re-exported, so the public API (`func.js` mounts these on `window`) is
// unchanged.

import { _DATE, timeNow, returnLang, advanceDateToToday } from './shared/format.js';
import { isBookmarkletUrl } from './shared/url.js';

export { _DATE, DAY, timeNow, returnLang, getVersion, getVersionType } from './shared/format.js';
export { isBookmarkletUrl, get_host } from './shared/url.js';
export { getFaviconUrl, getFaviconOnerror } from './shared/favicon.js';

// --- Date/Time ---

function TimeToStr(time, skip_date, skip_year, skip_clock) {
    advanceDateToToday();
    var tf = localStorage['rh-timeformat'];
    var currentTime = new Date(time);
    var hours = currentTime.getHours();
    var minutes = currentTime.getMinutes();
    // Declared with a default: a 24h clock has no suffix, and an unset or
    // corrupt rh-timeformat used to leave it undefined, which then rendered as
    // the literal text "undefined" (see the last `return` below).
    var te = '';
    if (time == undefined) {
        hours = '--';
        minutes = '--';
    } else {
        if (tf == '12') {
            if (hours > 11) {
                te = ' ' + returnLang('PM');
            } else {
                te = ' ' + returnLang('AM');
            }
            if (hours == 0) { hours = 12; }
            if (hours > 12) { hours = hours - 12; }
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

/**
 * Escape a string for safe interpolation into a RegExp literal.
 *
 * User-configurable values must never reach `new RegExp()` raw: a configuration
 * holding 'a(' throws SyntaxError, and a plain '.' silently matches any
 * character.
 */
function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// --- Favicon rendering ---

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
// The shared-bottom-layer symbols are re-exported in the `export ... from`
// blocks at the top of this file; everything below is page-only.
export {
    TimeToStr, formatDate,
    echoLang,
    stripScripts, title_fix, escapeHtmlAttr, escapeRegExp, truncate, extractFileName, calcSize,
    getUrlVars, extractBookmarkletCode, decodeBookmarkletCode, executeBookmarklet,
    chromeURL,
    Clipboard,
    popup_scrollbar_fix,
    setupFaviconElement
};