// Tree Style History - Helper Utilities Module
// Pure utility functions with minimal side effects.
//
// The functions that must also run inside the Service Worker live in
// `modules/shared/` — the dependency-free bottom layer that
// `scripts/gen-sw-utils.mjs` mechanically flattens into
// `scripts/background-utils.js`. They are imported for internal use and
// re-exported, so importers see one module rather than two layers.

import { _DATE, returnLang, advanceDateToToday } from './shared/format.js';
import { isBookmarkletUrl } from './shared/url.js';

/**
 * The `rh-date` display format, e.g. `'dd/mm/yyyy'`.
 *
 * Falls back to the default because this is read while a page initialises, in
 * the window before storage-adapter.js has resolved chrome.storage.local —
 * where every key still reads `undefined`. Callers go straight to
 * `.replace()` on the result, so without the fallback a cold page start threw
 * inside its own DOMContentLoaded handler and left the rest of the page
 * uninitialised: no date dropdowns, no calendar, no list.
 */
function dateFormat() {
    return storageAdapter.getItem('rh-date') || 'mm/dd/yyyy';
}

export { _DATE, DAY, timeNow, returnLang, getVersion, getVersionType } from './shared/format.js';
export { isBookmarkletUrl, get_host } from './shared/url.js';
export { getFaviconUrl, getFaviconOnerror } from './shared/favicon.js';

// --- Date/Time ---

function TimeToStr(time, skip_date, skip_year, skip_clock) {
    advanceDateToToday();
    var tf = storageAdapter.getItem('rh-timeformat');
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
    var datestr = storageAdapter.getItem('rh-date');
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
    // Same cold-start window as dateFormat() / TimeToStr(): before the storage
    // cache resolves, every key reads undefined. `.replace()` on undefined
    // throws inside the page's DOMContentLoaded handler and the listeners
    // registered after it (delete buttons, search) never get bound.
    var datestr = dateFormat();
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

// --- String utilities ---

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
 * Escape a string for interpolation as element TEXT CONTENT, i.e.
 * `'>' + value + '<'`.
 *
 * The counterpart of escapeHtmlAttr(), which covers `attr="' + value + '"`.
 * Two functions rather than one taking a mode flag: the name records which
 * context the value was escaped for, and a name is what a static check can
 * grep for. Quotes are left alone here — in a text position they need no
 * escaping, and escaping them rewrites the title the user actually wrote.
 *
 * Replaces the old title_fix(), which deleted '<', '>' and '/' instead of
 * escaping them. Deleting is what made slashes disappear from history titles,
 * and its partial escaping of '"' meant the result could not be escaped again
 * without the entity showing up as literal text.
 *
 * Note what this does NOT do: strip <script> blocks. Once '<' is escaped the
 * markup cannot run, so removing it would only lose text the user wrote — the
 * same temptation title_fix() gave in to. escapeHtmlAttr() does not strip
 * either: the two differ in exactly one respect, how they treat quotes, and
 * that difference is the whole reason they have two names.
 *
 * As in escapeHtmlAttr(), '&' has to go first: escaping it last would turn the
 * '&' of an entity this function just produced into '&amp;'.
 */
function escapeHtmlText(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
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

/**
 * A unique id for an element built from an HTML string and looked up with $().
 *
 * Seventeen copies of `Math.floor(Math.random() * 999999999999999999) +
 * 100000000000000000` lived in the two list renderers and in the options
 * page's three list builders. The magnitude is not load-bearing (an id only
 * has to be unique inside one document), so the shared helper drops the
 * 18-digit arithmetic for a base-36 slice — same job, and
 * `Math.random().toString(36)` never produces an exponent.
 */
var _idSeq = 0;
function uniqueId(prefix) {
    _idSeq += 1;
    return prefix + '-' + _idSeq.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * The tooltip for a list row: title, URL, time, joined with ' | '.
 *
 * The popup and the bookmark page each carried their own copy, and they had
 * already drifted — only one of them skipped the URL when it duplicated the
 * title, so a bookmark titled by its URL showed that URL twice. `time` is
 * optional: a history row has one, a most-visited row does not.
 */
function tooltipText(title, url, time) {
    var parts = [];
    if (title) parts.push(title);
    // A bookmarklet's URL is `javascript:...` — useless as a tooltip, and long
    // enough to crowd out the title it is supposed to accompany.
    if (!isBookmarkletUrl(url) && url && title !== url) parts.push(url);
    if (time !== undefined && time !== null && time !== '') parts.push(time);
    var tip = parts.join(' | ');
    if (!tip) tip = isBookmarkletUrl(url) ? '[Bookmarklet]' : (url || '');
    return tip;
}

/**
 * The twelve `<option>` elements of the month picker.
 *
 * Byte-identical in history.js, history2.js and closed.js — three copies of a
 * string that has no reason to vary, so a month label would have had to be
 * changed in three places.
 */
function monthOptionsHtml() {
    var html = '';
    for (var m = 1; m <= 12; m++) {
        var v = m < 10 ? '0' + m : String(m);
        html += '<option value="' + v + '">' + v + '</option>';
    }
    return html;
}

function truncate(str, ind, lng) {
    if (str.length > lng) {
        return str.substring(ind, lng) + '...';
    } else {
        return str.substring(ind, lng);
    }
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
    catch {
        try { decoded = decodeURI(code); }
        catch { decoded = code; }
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
        } else {
            // MV3 always ships chrome.scripting; this is here so a broken
            // manifest fails loudly instead of silently doing nothing.
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

// --- Favicon rendering ---

// How long an <img> is allowed to stay pending before it is given up on.
//
// A favicon service that is *unreachable* rather than *broken* — blocked,
// firewalled, or on a network that blackholes the connection — never fires
// `error`: the request simply stays open. Chrome's own connect timeout is
// minutes, so the image sits incomplete for as long as the popup is open.
// That does not block rendering (the rows are visible in well under 100ms),
// but it does hold the document's `load` event open, and Chrome sizes the
// popup — and finishes its open animation — on that event. Measured on a
// blocked host: `loadEventEnd` stayed 0 and `readyState` stayed
// `interactive` while the popup was plainly usable on screen.
//
// So the image is cut loose on a timer: fall back, then blank, exactly as a
// real error would. The in-flight request is abandoned rather than cancelled
// — `img.src = ''` would release it, but it also fires another `error` and
// Chrome keeps the connection until it times out anyway.
const FAVICON_TIMEOUT_MS = 4000;

// Setup favicon image element with error and load-based fallback detection
// Some services (e.g. Google) return a default 16x16 icon with HTTP 404 status.
// The <img> 'error' event does NOT fire for valid image data even with 404,
// so we also check the 'load' event and detect suspiciously small icons.
function setupFaviconElement(imgEl, primaryUrl, fallbackUrl) {
    if (!imgEl) return;
    var _checked = false;
    var _retryCount = 0;
    var _timer = null;

    // Cancel whatever deadline is pending. Called before a new `src` is set
    // and on every terminal event, so exactly one timer is ever live.
    function settle() {
        if (_timer !== null) {
            clearTimeout(_timer);
            _timer = null;
        }
    }

    /** Arm the deadline for whatever `img` is currently loading. */
    function arm(img) {
        settle();
        // No `complete` check inside: a finished image has already cleared
        // this timer through `settle()`, so by the time it fires the image is
        // still pending by construction.
        _timer = setTimeout(function () {
            _timer = null;
            failed(img);
        }, FAVICON_TIMEOUT_MS);
    }

    function failed(img) {
        _retryCount++;
        // Only attempt fallback once; subsequent failures just show blank
        if (_retryCount === 1 && fallbackUrl) {
            img.src = fallbackUrl;
            // The fallback is another remote request and can hang the same
            // way, so it gets a deadline of its own.
            arm(img);
        } else {
            settle();
            img.src = 'images/blank.png';
        }
    }

    imgEl.addEventListener('error', function () {
        failed(this);
    });

    imgEl.addEventListener('load', function () {
        // The image is on screen, so whatever deadline was armed for it is
        // spent. This runs *before* the `_checked` gate because the handler
        // also fires for the fallback's own load: behind the gate, a
        // successful fallback would leave its timer live and the icon it just
        // painted would be swapped for the blank one when that timer expired.
        settle();
        if (_checked) return;
        _checked = true;
        // Google's default 404 icon is 16x16; most real favicons are >= 32x32
        // If the loaded image is suspiciously small, treat as failure
        if (this.naturalWidth <= 16 && this.naturalHeight <= 16 && fallbackUrl) {
            failed(this);
        }
    });

    if (primaryUrl) {
        // Armed before `src` is set: a cached icon can fire `load` early
        // enough that the timer would otherwise be started against an image
        // that has already finished.
        arm(imgEl);
        imgEl.src = primaryUrl;
    }
}

// --- Exports ---
// The shared-bottom-layer symbols are re-exported in the `export ... from`
// blocks at the top of this file; everything below is page-only.
export {
    dateFormat,
    TimeToStr, formatDate,
    escapeHtmlAttr, escapeHtmlText, escapeRegExp, truncate,
    getUrlVars, extractBookmarkletCode, decodeBookmarkletCode, executeBookmarklet,
    uniqueId, tooltipText, monthOptionsHtml,
    chromeURL,
    Clipboard,
    setupFaviconElement
};