// Tree Style History - Configuration Module
// Manages all configuration-related functions extracted from func.js.

import { $, $$, createElement } from '../dom-helper.js';
import { returnLang, get_host, escapeHtmlAttr, escapeHtmlText, escapeRegExp } from './helpers.js';
import { defaultValues, defaultConfig } from './shared/config-defaults.js';



// Load Options lang

function loadOptionsLang() {
    $('save').value = returnLang('saveOptions');
    Array.from($$('.help-tip')).forEach(function (el) {
        el.title = returnLang(el.id);
    });
}


// Simple HTML5 drag and drop for list reordering
function initSortable(containerId, callbacks) {
    var container = $(containerId);
    if (!container) return null;

    function makeItemsDraggable() {
        Array.from(container.children).forEach(function (child) {
            if (child.tagName === 'LI') {
                child.draggable = true;
            }
        });
    }
    makeItemsDraggable();

    container.addEventListener('dragstart', function (e) {
        var el = e.target;
        if (el.tagName !== 'LI') return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', Array.from(container.children).indexOf(el));
        if (callbacks && callbacks.onStart) {
            callbacks.onStart(el);
        }
    });

    container.addEventListener('dragend', function (e) {
        var el = e.target;
        if (el.tagName !== 'LI') return;
        if (callbacks && callbacks.onComplete) {
            callbacks.onComplete(el);
        }
    });

    container.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('drop', function (e) {
        e.preventDefault();
        var target = e.target;
        while (target && target !== container && target.tagName !== 'LI') {
            target = target.parentNode;
        }
        if (!target || target === container) return;
        var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var children = Array.from(container.children).filter(function (c) { return c.tagName === 'LI'; });
        var toIndex = children.indexOf(target);
        if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0) {
            var movedItem = children[fromIndex];
            if (fromIndex < toIndex) {
                container.insertBefore(movedItem, target.nextSibling);
            } else {
                container.insertBefore(movedItem, target);
            }
        }
    });

    return { container: container };
}


// Load options

function loadOptions(full) {

    $('rhitemsno').value = localStorage['rh-itemsno'];
    $('rctitemsno').value = localStorage['rct-itemsno'];
    $('rtitemsno').value = localStorage['rt-itemsno'];
    $('mvitemsno').value = localStorage['mv-itemsno'];
    $('rbitemsno').value = localStorage['rb-itemsno'];

    var rhilo_default = defaultValues["rh-list-order"].split(',');
    var rhilo = localStorage['rh-list-order'].split(',');

    for (var lo in rhilo_default) {
        if (rhilo.indexOf(rhilo_default[lo]) < 0)
            rhilo.push(rhilo_default[lo]);
    }

    $('rhlistorder').innerHTML = '';

    for (var lo in rhilo) {
        if (rhilo[lo] == 'rh-order') {
            $('rhlistorder').appendChild(createElement('li', { 'id': rhilo[lo], 'html': returnLang('recentHistory') }));
        } else if (rhilo[lo] == 'rct-order') {
            $('rhlistorder').appendChild(createElement('li', { 'id': rhilo[lo], 'html': returnLang('recentlyClosedTabs') }));
        } else if (rhilo[lo] == 'mv-order') {
            $('rhlistorder').appendChild(createElement('li', { 'id': rhilo[lo], 'html': returnLang('mostVisited') }));
        } else if (rhilo[lo] == 'rb-order') {
            $('rhlistorder').appendChild(createElement('li', { 'id': rhilo[lo], 'html': returnLang('recentBookmarks') }));
        } else if (rhilo[lo] == 'rt-order') {
            $('rhlistorder').appendChild(createElement('li', { 'id': rhilo[lo], 'html': returnLang('recentTabs') }));
        }
    }

    initSortable('rhlistorder', {
        onStart: function (el) {
            Array.from($$('#rhlistorder li')).forEach(function (els) {
                if (els !== el) {
                    els.style.opacity = '0.4';
                }
            });
        },
        onComplete: function (el) {
            Array.from($$('#rhlistorder li')).forEach(function (els) {
                els.style.opacity = '1';
            });
        }
    });

    function selectOptionByIdValue(selectId, value) {
        var select = $(selectId);
        if (select) {
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === value) {
                    select.options[i].selected = true;
                    break;
                }
            }
        }
    }

    selectOptionByIdValue('showPopup', localStorage['show-popup']);
    selectOptionByIdValue('rhhistorypage', localStorage['rh-historypage']);
    selectOptionByIdValue('rhdate', localStorage['rh-date']);
    selectOptionByIdValue('rhtime', localStorage['rh-timeformat']);
    selectOptionByIdValue('rhsearch', localStorage['rh-search']);
    selectOptionByIdValue('rhshare', localStorage['rh-share']);
    selectOptionByIdValue('rmpath', localStorage['rm-path']);
    selectOptionByIdValue('contextmenu', localStorage['use-contextmenu']);
    selectOptionByIdValue('rhsshowurl', localStorage['rhs-showurl']);
    selectOptionByIdValue('rhsshowsep', localStorage['rhs-showsep']);
    selectOptionByIdValue('rhsshowext', localStorage['rhs-showext']);
    
    selectOptionByIdValue('lessItem', localStorage['less-item']);
    if ($('faviconService')) {
        var favServiceSelect = $('faviconService');
        var favValue = localStorage['favicon-service'];
        for (var i = 0; i < favServiceSelect.options.length; i++) {
            if (favServiceSelect.options[i].value === favValue) {
                favServiceSelect.options[i].selected = true;
                break;
            }
        }
    }
    selectOptionByIdValue('shareFaviconCache', localStorage['share-favicon-cache']);
    selectOptionByIdValue('faviconServiceFallback', localStorage['favicon-service-fallback']);

    previewItem();

    $('rhsshowurl').addEventListener('change', function () {
        previewItem();
    });

    $('rhsshowsep').addEventListener('change', function () {
        previewItem();
    });

    $('rhsshowext').addEventListener('change', function () {
        previewItem();
    });

    $('rhwidth').value = parseInt(localStorage['rh-width'], 10);

    $('loadrange').value = parseInt(localStorage['load-range'], 10);
    $('loadrange2').value = parseInt(localStorage['load-range2'], 10);
    $('loadrange3').value = parseInt(localStorage['load-range3'], 10);
    $('loadrange4').value = parseInt(localStorage['load-range4'], 10);

    mostVisitedBlocklist();

    if (full)
        filteredDomainsList();

    selectOptionByIdValue('rhclick', localStorage['rh-click']);
    selectOptionByIdValue('rmclick', localStorage['rm-click']);

}



function downloadOptions() {

    chrome.storage.sync.get(null, function (result) {
        $('downloadConfig').value = returnLang('saving');

        for (const i in result) {
            if (i.indexOf('filterlist') < 0) {
                // Every underscore, not just the first: saveOptions() turns every
                // '-' into '_' on the way up, so 'favicon-service-fallback' used
                // to come back as 'favicon-service_fallback' — a key nobody reads.
                let j = i.replace(/_/g, '-');
                if (result != undefined)
                    localStorage[j] = result[i];
            }

            // console.log(i);
        }

        location.reload();

        // loadOptions(false);
        // $('downloadConfig').value = returnLang('downloadConfig');
    });

}



// Load slider

function loadSlider(id, min, max, current) {
    var input = $(id);
    var slider = $(id + '-slider');
    var handle = $(id + '-slider-handle');
    if (!input || !slider || !handle) return;

    input.style.textAlign = 'right';
    input.value = parseInt(localStorage[current], 10);

    function getHandleWidth() {
        return handle.offsetWidth || 10;
    }

    function updateSliderPosition() {
        var val = parseInt(input.value, 10);
        if (isNaN(val)) val = min;
        var percent = max > min ? (val - min) / (max - min) : 0;
        if (percent < 0) percent = 0;
        if (percent > 1) percent = 1;
        var sliderWidth = slider.clientWidth;
        var handleWidth = getHandleWidth();
        var maxLeft = Math.max(sliderWidth - handleWidth, 0);
        handle.style.marginLeft = Math.round(percent * maxLeft) + 'px';
    }

    function updateValue(val) {
        if (isNaN(val)) val = min;
        if (val < min) val = min;
        if (val > max) val = max;
        input.value = val;
        updateSliderPosition();
    }

    function getValueFromMouse(clientX) {
        var rect = slider.getBoundingClientRect();
        var handleWidth = getHandleWidth();
        var trackWidth = Math.max(rect.width - handleWidth, 1);
        var offsetX = clientX - rect.left - handleWidth / 2;
        var percent = offsetX / trackWidth;
        if (percent < 0) percent = 0;
        if (percent > 1) percent = 1;
        return Math.round(min + percent * (max - min));
    }

    // Initialize slider position after layout
    setTimeout(updateSliderPosition, 0);

    // Input events
    input.addEventListener('blur', function () {
        var cval = parseInt(input.value, 10);
        if (isNaN(cval) || cval < min) {
            input.value = min;
        } else if (cval > max) {
            input.value = max;
            alert(min + '-' + max);
        }
        updateSliderPosition();
    });

    input.addEventListener('keydown', function (e) {
        var val = parseInt(input.value, 10);
        if (isNaN(val)) val = min;
        if (e.keyCode == 40 && val > min) {
            input.value = --val;
            updateSliderPosition();
        } else if (e.keyCode == 38 && val < max) {
            input.value = ++val;
            updateSliderPosition();
        }
    });

    // Slider mouse events
    var isDragging = false;

    slider.addEventListener('mousedown', function (e) {
        updateValue(getValueFromMouse(e.clientX));
        isDragging = true;
        e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        updateValue(getValueFromMouse(e.clientX));
        e.preventDefault();
    });

    document.addEventListener('mouseup', function () {
        isDragging = false;
    });
}


// Save options

// Config keys use '-' and must never contain '_': saveOptions() replaces every
// '-' with '_' on the way into chrome.storage.sync and downloadOptions() every
// '_' back with '-'. Both are global replaces, so the pair is only reversible
// while no key holds an underscore — 'a-b' and 'a_b' would both upload as
// 'a_b' and collide on the way down. Asserted in tests/modules.test.mjs.
//
// The filter list is uploaded as `filterlist0`, `filterlist1`, … because
// chrome.storage.sync caps a single item at 8KB (~100 domains per slice).
const FILTERLIST_PREFIX = 'filterlist';
// Matches a slice, but deliberately not FILTERLIST_SLICES_KEY (it ends in
// letters), so the count is never mistaken for one of the slices it counts.
const FILTERLIST_SLICE_KEY = /^filterlist\d+$/;
// How many slices the last upload wrote — see dropStaleSlices()/mergeList().
const FILTERLIST_SLICES_KEY = 'filterlist_slices';
// Domains per slice. 100 domains average well under the 8KB per-item quota.
const SLICE_SIZE = 100;

// The callback flavour of chrome.storage reports failures out of band, via
// chrome.runtime.lastError. The upload path never read it, so a write that
// blew the quota failed silently while the UI reported success. These wrappers
// turn the outcome into a settled promise instead.
function syncSet(obj) {
    return new Promise(function (resolve, reject) {
        chrome.storage.sync.set(obj, function () {
            if (chrome.runtime.lastError)
                reject(new Error(chrome.runtime.lastError.message));
            else
                resolve();
        });
    });
}

function syncRemove(keys) {
    return new Promise(function (resolve, reject) {
        chrome.storage.sync.remove(keys, function () {
            if (chrome.runtime.lastError)
                reject(new Error(chrome.runtime.lastError.message));
            else
                resolve();
        });
    });
}

function syncGet(keys) {
    return new Promise(function (resolve, reject) {
        chrome.storage.sync.get(keys, function (result) {
            if (chrome.runtime.lastError)
                reject(new Error(chrome.runtime.lastError.message));
            else
                resolve(result);
        });
    });
}

/**
 * Uploading a shorter list used to leave the higher-numbered slices in sync
 * storage forever. A reader could not tell those apart from current ones, so
 * every domain the user had since deleted came straight back on the next
 * mergeList().
 */
function dropStaleSlices(keep) {
    return syncGet(null).then(function (result) {
        const stale = Object.keys(result).filter(function (key) {
            return FILTERLIST_SLICE_KEY.test(key)
                && Number(key.slice(FILTERLIST_PREFIX.length)) >= keep;
        });
        if (stale.length == 0)
            return undefined;
        return syncRemove(stale);
    });
}

/**
 * Gather the option form, write it to localStorage and — when `sync` — upload
 * it to chrome.storage.sync.
 *
 * Returns a promise that settles once the upload does, so a caller can
 * sequence work after it. It does NOT report whether the upload succeeded: a
 * rejected write is surfaced on the button and logged, then swallowed here so
 * one failed write cannot reject out of the click handler. Await this to order
 * work, not to check the result.
 */
function saveOptions(sync) {

    var so = {};

    //  弹出顺序    so['rh-list-order']
    var rhlo = $$('#rhlistorder li');

    // 获取最常访问列表项
    var mli = $$('#mvlist tr td:first-child');

    // 在最近访问历史中过滤指定域名。
    // chrome.storage.sync 提供一个 key 8K，最多 12 个 key，总数据量 100K（即不可能 12 个 key 都装满）的存储。
    // 因此需要对域名分组保存。每组 100 个域名（平均每个域名不超过 10byte，100 个不超过 8k），预留 10 组空间（不超过 80k）。
    var fli = $$('#flist tr td:first-child');
    var mlil = '';
    var flil = '';

    if (sync) {
        $('saveUpload').value = returnLang('saving');
    } else {
        $('save').value = returnLang('saving');
    }

    var mls = [];

    let cache = '';

    if (mli.length > 0) {
        for (var m = 0; m < mli.length; m++) {
            mlil += mli[m].textContent + '|';
        }
    } else {
        mlil = 'false';
    }

    if (fli.length > 0) {
        for (var f = 0; f < fli.length; f++) {
            flil += fli[f].textContent + '|';

            // Start a new slice every SLICE_SIZE domains: the whole point of
            // slicing is staying under the per-item quota, and `item` was never
            // incremented, so `item < 100` held forever and every domain ended
            // up in one slice that then blew the quota silently.
            if (f > 0 && f % SLICE_SIZE == 0) {
                mls[mls.length] = cache;
                cache = '';
            }
            cache += fli[f].textContent + '|';
        }

        mls[mls.length] = cache;
    } else {
        flil = 'false';
    }

    so['rh-itemsno'] = $('rhitemsno').value;
    so['rct-itemsno'] = $('rctitemsno').value;
    so['rt-itemsno'] = $('rtitemsno').value;
    so['rb-itemsno'] = $('rbitemsno').value;
    so['mv-itemsno'] = $('mvitemsno').value;
    so['rh-list-order'] = rhlo[0].id + ',' + rhlo[1].id + ',' + rhlo[2].id + ',' + rhlo[3].id + ',' + rhlo[4].id;
    so['rh-historypage'] = $('rhhistorypage').options[$('rhhistorypage').selectedIndex].value;
    so['show-popup'] = $('showPopup').options[$('showPopup').selectedIndex].value;
    so['rh-date'] = $('rhdate').options[$('rhdate').selectedIndex].value;
    so['rh-timeformat'] = $('rhtime').options[$('rhtime').selectedIndex].value;
    so['rh-search'] = $('rhsearch').options[$('rhsearch').selectedIndex].value;
    so['rhs-showurl'] = $('rhsshowurl').options[$('rhsshowurl').selectedIndex].value;
    so['rhs-showsep'] = $('rhsshowsep').options[$('rhsshowsep').selectedIndex].value;
    so['rhs-showext'] = $('rhsshowext').options[$('rhsshowext').selectedIndex].value;
    so['rh-width'] = $('rhwidth').value + 'px';
    so['load-range'] = $('loadrange').value;
    so['load-range2'] = $('loadrange2').value;
    so['load-range3'] = $('loadrange3').value;
    so['load-range4'] = $('loadrange4').value;
    so['less-item'] = $('lessItem').options[$('lessItem').selectedIndex].value;
    so['mv-blocklist'] = mlil;
    so['rh-click'] = $('rhclick').options[$('rhclick').selectedIndex].value;
    so['rm-click'] = $('rmclick').options[$('rmclick').selectedIndex].value;
    so['rm-path'] = $('rmpath').options[$('rmpath').selectedIndex].value;
    so['use-contextmenu'] = $('contextmenu').options[$('contextmenu').selectedIndex].value;
    so['rh-filtered'] = flil;
    if ($('faviconService')) {
        so['favicon-service'] = $('faviconService').options[$('faviconService').selectedIndex].value;
    }
    so['share-favicon-cache'] = $('shareFaviconCache').options[$('shareFaviconCache').selectedIndex].value;
    so['favicon-service-fallback'] = $('faviconServiceFallback').options[$('faviconServiceFallback').selectedIndex].value;
    so['popup-zoom'] = parseInt($('popupZoom').value, 10) || 100;
    so['page-zoom'] = parseInt($('pageZoom').value, 10) || 100;
    for (var i in so) {
        localStorage[i] = so[i];
        console.log(i + '=' + so[i]);
    }

    let upload;
    if (sync) {
        const config = {};
        for (var i in so) {
            // Uploaded as slices instead: one domain list easily exceeds the
            // 8KB per-item quota.
            if (i == 'rh-filtered')
                continue;
            // Every dash, not just the first: downloadOptions() turns every
            // '_' back into '-', so the two have to be exact mirror images.
            config[i.replace(/-/g, '_')] = so[i];
        }

        const slices = {};
        for (let j = 0; j < mls.length; j++) {
            // This used to write `so[i]` — `i` being the leaked loop variable
            // from the block above, i.e. always the last config key — so every
            // slice held the page-zoom value and the domains were never
            // uploaded at all.
            slices[FILTERLIST_PREFIX + j] = mls[j];
        }
        slices[FILTERLIST_SLICES_KEY] = String(mls.length);

        // Success used to be judged by counting callbacks after a 1500ms
        // guess and comparing the total against a hard-coded 26; there are 38
        // config keys, so it could never have matched and every successful
        // upload was reported as a failure. Promise.all settles when the
        // writes actually settle, and a rejected write is now visible.
        //
        // Held in a variable rather than returned here on purpose: the tail of
        // this function (updateFilter(), the context-menu refresh) has to run
        // for a synced save too.
        // dropStaleSlices() runs alongside the write rather than after it, and
        // that is safe: it only ever removes slice numbers >= the new count,
        // while syncSet(slices) only writes numbers below it. The two cannot
        // disagree whichever order chrome.storage processes them in.
        upload = Promise.all([
            syncSet(config),
            syncSet(slices),
            dropStaleSlices(mls.length),
        ]).then(
            function () {
                $('saveUpload').value = returnLang('saved');
            },
            function (err) {
                console.error('Failed to upload options:', err);
                $('saveUpload').value = returnLang('saveFail');
            },
        ).finally(function () {
            setTimeout(function () { $('saveUpload').value = returnLang('saveUpload') }, 3000);
        });
    } else {
        setTimeout(function () { $('save').value = returnLang('saved') }, 1500);
        setTimeout(function () { $('save').value = returnLang('saveOptions') }, 3000);
    }

    updateFilter();

    // Notify service worker to refresh context menu
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: 'refreshContextMenu' }).catch(function () {
            // SW may be inactive; message will restart it
        });
    }

    // Settles once the upload does, so a caller can wait for it. Rejections are
    // already surfaced through the button above; nothing else should throw.
    return upload || Promise.resolve();
}


// Preview item

function previewItem() {
    var surl = $('rhsshowurl').options[$('rhsshowurl').selectedIndex].value;
    var ssep = $('rhsshowsep').options[$('rhsshowsep').selectedIndex].value;
    var sext = $('rhsshowext').options[$('rhsshowext').selectedIndex].value;
    if (surl == 'yes') {
        $('rhitemstyle-url').style.display = 'inline';
    } else {
        $('rhitemstyle-url').style.display = 'none';
    }
    if (ssep == 'yes') {
        $('rhitemstyle').style.borderBottom = '1px solid #ccc';
    } else {
        $('rhitemstyle').style.borderBottom = '0 none';
    }
    if (sext == 'yes') {
        $('rhitemstyle-info').style.display = 'inline';
    } else {
        $('rhitemstyle-info').style.display = 'none';
    }
    if (sext == 'yes' && surl == 'yes') {
        $('rhitemstyle-sep').style.display = 'inline';
    } else {
        $('rhitemstyle-sep').style.display = 'none';
    }
}


// Most visited blocklist

function mostVisitedBlocklist() {
    var mvbl = localStorage['mv-blocklist'];
    if (mvbl.length > 0 && mvbl !== 'false') {
        mvbl = mvbl.split('|');
        if (mvbl.length > 0) {
            for (var i = 0; i < mvbl.length; i++) {
                if (mvbl[i] !== undefined && mvbl[i] !== '') {
                    var linkid = 'link-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                    // Escaped: entries are URLs taken from browsing history, so
                    // a quote in one would otherwise close this attribute. This
                    // function only started running once #mvlist-table existed
                    // in options.html, so the escaping was added together with
                    // that element rather than left for the P0 XSS batch that
                    // still covers filteredDomainsList() and addList() below.
                    // One escaper per context: the same value goes into a title
                    // attribute and into the visible text, and the text
                    // escaper leaves quotes alone rather than rewriting them.
                    var mvblAttr = escapeHtmlAttr(mvbl[i]);
                    var mvblText = escapeHtmlText(mvbl[i]);
                    var tr = createElement('tr', { html: '<td><div title="' + mvblAttr + '">' + mvblText + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' });
                    $('mvlist-table').appendChild(tr);
                    $(linkid).addEventListener('click', function () {
                        this.closest('tr').remove();
                    });
                }
            }
        }
    }
}


// Filtered domains list

function filteredDomainsList() {
    var fbl = localStorage['rh-filtered'];
    if (fbl.length > 0 && fbl !== 'false') {
        fbl = fbl.split('|');
        if (fbl.length > 0) {
            for (var i = 0; i < fbl.length; i++) {
                if (fbl[i] !== undefined && fbl[i] !== '') {
                    var linkid = 'link-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                    // One escaper per context: the same value goes into a title
                    // attribute and into the visible text, and the text escaper
                    // leaves quotes alone rather than rewriting them.
                    var fblAttr = escapeHtmlAttr(fbl[i]);
                    var fblText = escapeHtmlText(fbl[i]);
                    var tr = createElement('tr', { html: '<td><div title="' + fblAttr + '">' + fblText + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' });
                    $('flist-table').appendChild(tr);
                    $(linkid).addEventListener('click', function () {
                        this.closest('tr').remove();
                    });
                }
            }
        }
    }
}


// Add filtered item

function addFilteredItem() {
    addList($('flist-add-i').value);
}

function addList(item) {
    // \s+ rather than ' ': replace(' ', '') only removed the *first* space, so a
    // pasted " example.com " kept its trailing space, failed the URL test below
    // and was rejected outright with an "invalid URL" alert.
    var fliv = item.replace(/\s+/g, '');
    if (fliv == 'false' || fliv == '')
        return false;
    var flic = 'test';
    {
        var rel = /^(https?|ftp|file)?[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]$/
        if (!rel.test(fliv)) {
            alert(returnLang('plsInputUrl'));
        } else if (fliv.length > 140) {
            alert(returnLang('longInputUrl'));
        } else {
            var flistCells = $$('#flist-table tr td:first-child');
            for (var fi = 0; fi < flistCells.length; fi++) {
                if (flistCells[fi].textContent == fliv) {
                    flic = flistCells[fi].textContent;
                }
            }
            if (flic == 'test') {
                var linkid = 'link-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                // One escaper per context, as in filteredDomainsList() above.
                var flivAttr = escapeHtmlAttr(fliv);
                var flivText = escapeHtmlText(fliv);
                var tr = createElement('tr', { html: '<td><div title="' + flivAttr + '">' + flivText + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' });
                $('flist-table').appendChild(tr);
                $('flist-add-i').value = '';
                $(linkid).addEventListener('click', function () {
                    this.closest('tr').remove();
                });
                return true;
            }

        }
    }
    return false;
}

// 合并本地列表和在线列表（但是不保存）
function mergeList() {
    return syncGet(null).then(function (result) {

        let cache = '';
        // Read exactly the slices the last upload recorded. Probing for the
        // first missing slice instead — the earlier approach, and before that a
        // hard-coded 11 — swallowed every slice left behind by a longer previous
        // list and resurrected domains the user had since deleted.
        //
        // Missing metadata means the data predates filterlist_slices (or the
        // upload never happened), so there is nothing safe to merge: Number()
        // turns undefined into NaN and the loop below does not run.
        const slices = Number(result[FILTERLIST_SLICES_KEY]);
        for (let i = 0; i < slices; i++) {
            let r = result[FILTERLIST_PREFIX + i];
            if (r != undefined && r != '')
                cache += r;
        }

        let c = 0;
        const fbl = cache.split('|');
        for (let i = 0; i < fbl.length; i++) {
            if (fbl[i] !== undefined && fbl[i] !== '') {
                if (addList(fbl[i]))
                    c++;
            }
        }

        alert(returnLang('addItemNum') + c);
    }).catch(function (err) {
        console.error('Failed to merge the online filter list:', err);
    });
}


// Filter variables and functions

// 'false' rather than '': it is the sentinel filtUrl() and mostVisited() check
// for, so nothing is filtered until updateFilter() has read a real list.
var flist = 'false';
var flist_r = /^false$/;
// The configured domains, split into whole entries — see domainsToSet().
var flist_set = new Set();
// Set once a real value has been read; until then filtUrl() retries on use.
var filterLoaded = false;
// var addon_url='';

// Refresh once storage is readable.
//
// There is deliberately no updateFilter() call at module top level: ES modules
// are evaluated before storage-adapter.js has resolved chrome.storage.local, so
// every key reads as undefined at that point. The old top-level call then wrote
// the "false" sentinel — an async chrome.storage.local.set() that raced the
// pending get(null) and, when it won, destroyed the user's saved filter list.
// defaultConfig() (service worker startup, options page) owns initialising the
// key, so a reader must never be its writer.
if (typeof window.onStorageReady === 'function') {
    window.onStorageReady(updateFilter);
}

/**
 * Split the stored 'a.com|b.com|' list into a set of whole, lower-cased
 * domains.
 *
 * filtUrl() used to search `flist` with indexOf(), which matches substrings and
 * therefore ignores label boundaries: a configured `b.com` filtered `b.co`, and
 * `sub.example.com` filtered `example.com`. Comparing against a set of whole
 * entries is what makes the boundary meaningful.
 */
function domainsToSet(list) {
    var set = new Set();
    if (typeof list !== 'string' || list === 'false') return set;
    var parts = list.split('|');
    for (var i = 0; i < parts.length; i++) {
        var domain = parts[i].trim().toLowerCase();
        if (domain !== '') set.add(domain);
    }
    return set;
}

function updateFilter() {
    var stored = localStorage['rh-filtered'];
    // undefined means storage has not been read yet, which is NOT the same as
    // "the user filters nothing". Bail out and let the next filtUrl() retry,
    // rather than caching an empty list that happens to look final.
    if (stored === undefined) return;
    filterLoaded = true;
    flist = (stored == '' || stored == 'false') ? 'false' : stored;
    flist_set = domainsToSet(flist);

    // Built from the normalised set rather than from the raw string:
    //   * entries are regex-escaped, so a value like 'a(' no longer throws
    //     SyntaxError and a '.' no longer acts as a wildcard;
    //   * there is no empty alternative — the raw 'a.com|b.com|' ends in '|',
    //     and interpolating it produced a branch that matched every URL.
    // An empty set means "nothing is filtered", so keep the never-matching
    // sentinel instead of compiling `[^?=#]*().*`, which matches anything.
    flist_r = flist_set.size === 0
        ? /^false$/
        : new RegExp('[^?=#]*(' + [...flist_set].map(escapeRegExp).join('|') + ').*', 'i');

    // addon_url=document.URL.replace('background.html','');
    // console.log('addon_url = '+addon_url);
}

// 如果命中，返回true
function filtUrl(url) {
    // Safety net for callers that run before the onStorageReady hook above:
    // retry until storage has actually been read. Without this, filtering would
    // silently depend on page scripts and func.js registering their ready
    // callbacks in the right order.
    if (!filterLoaded) updateFilter();

    if (flist == undefined || flist == 'false' || url == undefined || url == '')
        return false;

    // A listed domain is meant to cover its www host as well: users filter
    // "example.com" and expect www.example.com to go with it.
    //
    // The old code tried to get there by stripping a leading label, but its
    // guard (`site_r`, /(.+\.){3,}/) only fired for hosts with 4+ labels and
    // the replacement needed a doubled dot — no hostname has one — so the
    // branch never ran and www.example.com slipped through.
    //
    // Only www is stripped, not every leading label: dropping those too would
    // make a listed "b.com" filter "xb.com" as well.
    var site = get_host(url).toLowerCase();
    if (!flist_set.has(site) && site.startsWith('www.')) {
        site = site.substring('www.'.length);
    }

    if (flist_set.has(site)) {
        return flist_r.test(url);
    }

    return false;
}


// --- Exports ---

export {
    defaultValues,
    defaultConfig,
    loadOptions,
    saveOptions,
    downloadOptions,
    loadSlider,
    loadOptionsLang,
    initSortable,
    previewItem,
    mostVisitedBlocklist,
    filteredDomainsList,
    addFilteredItem,
    addList,
    mergeList,
    updateFilter,
    filtUrl,
    flist,
    flist_r
};
