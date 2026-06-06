// Tree Style History - Configuration Module
// Manages all configuration-related functions extracted from func.js.

import { $, $$, createElement } from '../dom-helper.js';
import { returnLang, get_host } from './helpers.js';


// Default config values

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
    "favicon-service": "duckduckgo",
    "share-favicon-cache": "yes",
    "favicon-service-fallback": ""
};

function defaultConfig(clean) {
    for (var v in defaultValues) {
        if (clean || !localStorage[v] || localStorage[v] == null || localStorage[v] == '') {
            localStorage[v] = defaultValues[v];
        }
    }
}


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
    selectOptionByIdValue('rhsshowbg', localStorage['rhs-showbg']);
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
        console.log('Value currently is ' + result.key); ve = result;

        for (i in result) {
            if (i.indexOf('filterlist') < 0) {
                let j = i.replace('_', '-');
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

    let group = 0;
    let item = 0;
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

            if (item < 100) {
                cache += fli[f].textContent + '|';
            } else {
                mls[group] = cache;
                group++;
                item = 0;
                cache = fli[f].textContent + '|';
            }
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
    for (var i in so) {
        localStorage[i] = so[i];
        console.log(i + '=' + so[i]);
    }

    if (sync) {


        let c = 0
        for (var i in so) {
            if (i == 'rh-filtered')
                continue;

            let o = {};
            o[i.replace('-', '_')] = so[i];
            chrome.storage.sync.set(o, function () {
                c++;
            });
        }

        for (let j = 0; j <= mls.length; j++) {

            let o = {};
            o['filterlist' + j] = so[i];
            chrome.storage.sync.set(o, function () {
                c++;
            });
        }

        setTimeout(function () {
            console.log('c=' + c + ' mls=' + mls.length + ' so=' + so.length);
            if (c - mls.length == 26)
                $('saveUpload').value = returnLang('saved')
            else
                $('saveUpload').value = returnLang('saveFail')
        }, 1500);

        setTimeout(function () { $('saveUpload').value = returnLang('saveUpload') }, 3000);
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
                    var tr = createElement('tr', { html: '<td><div title="' + mvbl[i] + '">' + mvbl[i] + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' });
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
                    var tr = createElement('tr', { html: '<td><div title="' + fbl[i] + '">' + fbl[i] + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' });
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
    var fliv = item.replace(' ', '');
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
                var tr = createElement('tr', { html: '<td><div title="' + fliv + '">' + fliv + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' });
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
    chrome.storage.sync.get(null, function (result) {

        let cache = '';
        for (let i = 0; i < 11; i++) {
            let r = result['filterlist' + i];
            if (r != undefined && r != '')
                cache += r;
        }

        let c = 0;
        {
            fbl = cache.split('|');
            if (fbl.length > 0) {
                for (let i = 0; i < fbl.length; i++) {
                    if (fbl[i] !== undefined && fbl[i] !== '') {
                        if (addList(fbl[i]))
                            c++;
                    }
                }
            }
        }

        alert(returnLang('addItemNum') + c);
    });
}


// Filter variables and functions

var flist = '';
var flist_r = /^false$/;
var site_r = /(.+\.){3,}/;
// var addon_url='';
updateFilter();

function updateFilter() {
    flist = localStorage['rh-filtered'];
    if (flist == undefined || flist == '' || flist == 'false') {
        flist = 'false';
        flist_r = /^false$/;
        localStorage['rh-filtered'] = flist;
    } else {
        flist_r = new RegExp('[^\?=#]*(' + flist + ').*', 'i');
    }

    // addon_url=document.URL.replace('background.html','');
    // console.log('addon_url = '+addon_url);
}

// 如果命中，返回true
function filtUrl(url) {
    if (flist == undefined || flist == 'false' || url == undefined || url == '')
        return false;

    var site = get_host(url);
    if (flist.indexOf(site + '|') >= 0)
        return true;

    if (site_r.test(site)) {
        site = site.replace(/[\.]+\./, '');
    }

    if (flist.indexOf(site) >= 0) {
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
    flist_r,
    site_r
};
