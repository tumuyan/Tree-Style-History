// Version
// MooTools removed - using native DOM API

function getVersion() {
    // Directly get version from manifest.json
    return chrome.runtime.getManifest().version;
}


// Version Type

function getVersionType() {
    return 'browserAction';
}


// Global vars

var ctrlState = 'false';
var shiftState = 'false';
var itemSelectedColor = '#ffcbd3';
var selectedItem;
var prh;



var _DATE = new Date();
_DATE.setHours(0); _DATE.setMinutes(0); _DATE.setSeconds(0); _DATE.setMilliseconds(0);
var DAY = 24 * 3600 * 1000;

function TimeToStr(time, skip_date, skip_year, skip_clock) {

    if (new Date() - _DATE > DAY)
        _DATE = _DATE + DAY;


    var tf = localStorage['rh-timeformat'];

    var currentTime = new Date(time);
    var hours = currentTime.getHours() * 1;
    var minutes = currentTime.getMinutes() * 1;

    if (time == undefined) {
        hours = '--';
        minutes = '--';
    } else {
        if (tf == '12') {
            if (hours > 11) {
                var te = ' ' + returnLang('PM');
            } else {
                var te = ' ' + returnLang('AM');
            }
            if (hours == 0) {
                hours = 12;
            }
            if (hours > 12) {
                hours = hours - 12;
            }
        } else if (tf == '24') {
            var te = '';
        }
        if (hours < 10) {
            hours = '0' + hours;
        }
        if (minutes < 10) {
            minutes = '0' + minutes;
        }

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
        datestr = datestr.replace('yyyy', currentTime.year);
    }

    return datestr + ' ' + hours + ':' + minutes + te;
}


var calendar_storage2 = {};
onStorageReady(function () {
    var calendar_storage2_str = localStorage['calendar-storage2'];
    if (calendar_storage2_str != undefined) {
        calendar_storage2 = JSON.parse(calendar_storage2_str);
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
// Popup scrollbar fix

function popup_scrollbar_fix() {
    var ps = document.body.offsetHeight;
    var pss = document.body.scrollHeight;
    if (pss > ps) {
        $('popup').style.marginRight = '24px';
    } else {
        $('popup').style.marginRight = '5px';
    }
}


function stripScripts(text) {
    return text.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
}

function title_fix(text) {
    return stripScripts(text).replace(/\"/g, '&#34;').replace(/\</g, '').replace(/\>/g, '').replace(/\//g, '');
}


// Escape HTML attribute values to prevent injection
function escapeHtmlAttr(text) {
    if (text === undefined || text === null) {
        return '';
    }
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}


function isBookmarkletUrl(url) {
    if (typeof url !== 'string') {
        return false;
    }
    return /^javascript\s*:/i.test(url.trim());
}


function extractBookmarkletCode(url) {
    if (!isBookmarkletUrl(url)) {
        return '';
    }
    return url.replace(/^javascript\s*:\s*/i, '');
}


function decodeBookmarkletCode(code) {
    if (!code) {
        return '';
    }
    var decoded = code;
    try {
        decoded = decodeURIComponent(code);
    } catch (e1) {
        try {
            decoded = decodeURI(code);
        } catch (e2) {
            decoded = code;
        }
    }
    return decoded;
}


function executeBookmarklet(url, options) {
    options = options || {};
    var code = extractBookmarkletCode(url);
    if (!code) {
        if (options.onFailure) {
            options.onFailure();
        }
        return;
    }

    var scriptToRun = options.decode === false ? code : decodeBookmarkletCode(code);

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs || tabs.length === 0) {
            if (options.onFailure) {
                options.onFailure();
            }
            return;
        }
        var tabId = tabs[0].id;
        
        // Use chrome.scripting.executeScript with MAIN world for Manifest V3
        // Execute in MAIN world to access page's JavaScript context
        if (chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                func: function (code) {
                    try {
                        (new Function(code))();
                    } catch (e) {
                        console.error('Bookmarklet execution error:', e);
                        throw e;
                    }
                },
                args: [scriptToRun]
            }, function (results) {
                if (chrome.runtime.lastError) {
                    console.error('Failed to execute bookmarklet:', chrome.runtime.lastError);
                    if (options.onFailure) {
                        options.onFailure(chrome.runtime.lastError);
                    }
                } else {
                    if (options.onSuccess) {
                        options.onSuccess();
                    }
                }
            });
        } else {
            // Fallback for older Chrome versions (Manifest V2)
            if (chrome.tabs && chrome.tabs.executeScript) {
                chrome.tabs.executeScript(tabId, { code: scriptToRun }, function () {
                    if (chrome.runtime.lastError) {
                        console.error('Failed to execute bookmarklet:', chrome.runtime.lastError);
                        if (options.onFailure) {
                            options.onFailure(chrome.runtime.lastError);
                        }
                    } else {
                        if (options.onSuccess) {
                            options.onSuccess();
                        }
                    }
                });
            } else {
                console.error('No available API to execute bookmarklet');
                if (options.onFailure) {
                    options.onFailure(new Error('No available API to execute scripts'));
                }
            }
        }
    });
}


// Get url vars

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


// Leap year

function isLeapYear() {
    var select = $('date-select-year');
    if (!select || !select.options || select.options.length === 0) return false;
    var selectedOption = select.options[select.selectedIndex];
    if (!selectedOption) return false;
    var year = selectedOption.value * 1;
    return (year % 400 == 0 || (year % 100 != 0 && year % 4 == 0));
}


// Time

function timeNow(st) {
    var tf = localStorage['rh-timeformat'];
    if (st == 0) {
        var currentTime = new Date();
    } else {
        var currentTime = new Date(st);
    }
    var hours = currentTime.getHours() * 1;
    var minutes = currentTime.getMinutes() * 1;
    if (tf == '12') {
        if (hours > 11) {
            var te = ' ' + returnLang('PM');
        } else {
            var te = ' ' + returnLang('AM');
        }
        if (hours == 0) {
            hours = 12;
        }
        if (hours > 12) {
            hours = hours - 12;
        }
    } else if (tf == '24') {
        var te = '';
    }
    if (hours < 10) {
        hours = '0' + hours;
    }
    if (minutes < 10) {
        minutes = '0' + minutes;
    }
    return hours + ':' + minutes + te;
}


// Format date

function formatDate(str) {

    var datestr = localStorage['rh-date'];
    if (str == undefined) {
        datestr = datestr.replace('dd', '--');
        datestr = datestr.replace('mm', '--');
        datestr = datestr.replace('yyyy', '----');
    } else {
        str = str * 1;
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


// Truncate

function truncate(str, ind, lng) {
    if (str.length > lng) {
        return str.substring(ind, lng) + '...'
    } else {
        return str.substring(ind, lng);
    }
}


// Open chrome URL

function chromeURL(url) {
    chrome.tabs.create({
        url: url,
        selected: true
    });
}


// Echo lang

function echoLang(str) {
    document.write(chrome.i18n.getMessage(str));
}


// Return lang

function returnLang(str) {
    return chrome.i18n.getMessage(str);
}


// Copy text

Clipboard = {};
Clipboard.utilities = {};
Clipboard.utilities.createTextArea = function (value) {
    var txt = document.createElement('textarea');
    txt.style.position = "absolute";
    txt.style.left = "-100%";
    if (value != null)
        txt.value = value;
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


// Left click

function leftClick(url) {

    event.preventDefault();

    // Handle bookmarklets by executing them instead of navigating
    if (isBookmarkletUrl(url)) {
        executeBookmarklet(url, {
            decode: true,
            fallbackToUpdate: true,
            onSuccess: function () {
                // Close popup if needed
                if (ctrlState != 'true' && (localStorage['rh-click'] === 'newtab' || localStorage['rh-click'] === 'current')) {
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
    var cs = ctrlState;
    if (cs == 'true' || event.button == 1) {
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
    "favicon-service": "duckduckgo"
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
    $(id).style.textAlign = 'right';
    $(id).value = parseInt(localStorage[current], 10);
    $(id).addEventListener('blur', function () {
        var cval = $(id).value * 1;
        if (cval >= min && cval <= max) {
            $(id).value = cval;
        } else {
            $(id).value = min;
            alert(min + '-' + max);
        }
    });
    $(id).addEventListener('keydown', function (e) {
        if (e.keyCode == 40 && ($(id).value * 1) > min) {
            $(id).value = ($(id).value * 1) - 1;
        }
    });
    $(id).addEventListener('keydown', function (e) {
        if (e.keyCode == 38 && ($(id).value * 1) < max) {
            $(id).value = ($(id).value * 1) + 1;
        }
    });
}


// Save options

function saveOptions(sync) {

    var so = {};

    //  弹窗顺序    so['rh-list-order']
    var rhlo = $$('#rhlistorder li');

    // ???
    var mli = $$('#mvlist tr td:first-child');

    //  在最近访问历史中过滤指定域名。
    // chrome.storage.sync 提供一个 key 8K，最大512个 key，总数据量100K（即不可能512个 key 都装满）的存储。
    // 因此需要对域名分组保存。每组100个域名（平均每个域名不超过80byte，100个不超过8k),预留10组的空间（不超过80k）
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
        for (m = 0; m < mli.length; m++) {
            mlil += mli[m].textContent + '|';
        }
    } else {
        mlil = 'false';
    }

    if (fli.length > 0) {
        for (f = 0; f < fli.length; f++) {
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
            for (i = 0; i < mvbl.length; i++) {
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
            for (i = 0; i < fbl.length; i++) {
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

// 合并当且列表和在线列表（但是不保存）
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


// Popup search

function popupSearch(q) {
    if (q !== '' && q !== undefined) {
        chrome.history.search({ text: q, maxResults: 30 }, function (hi) {
            if (hi.length > 0) {
                $('popup-search-insert').textContent = '';
                for (i = 0; i <= hi.length; i++) {
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
        item += '<img class="favicon" alt="Favicon" src="' + escapeHtmlAttr(faviconSrc) + '">';
    }
    else {
        item += '<img class="favicon" alt="Favicon">';
    }

    item += '<span class="title" title="' + escapeHtmlAttr(tip) + '"><span class="edit-items-ui" data-url="' + escapeHtmlAttr(url) + '" data-title="' + escapeHtmlAttr(tip) + '">' + ui + '</span>' + title + '</span>';

    // For bookmarklets, show simplified URL in the extra-url section
    var urlDisplay = isBookmarkletUrl(url) ? 'javascript:...' : url.replace(/^(.*?)\:\/\//, '').replace(/\/$/, '');
    item += '<span ' + saext + ' class="extra-url"><span ' + sext + ' class="extra">' + returnLang("visits") + ': ' + visits + extsep + '</span><span ' + surl + ' class="url">' + escapeHtmlAttr(urlDisplay) + '</span></span>';



    var click = function () {
        leftClick(url);
    };


    // switch tab
    if (data.tabId != undefined) {
        click = function () {
            openTab(data.tabId);
        }
    } else if (data.sessionId != undefined) {
        click = function () {
            chrome.sessions.restore(data.sessionId, function (session) { })
        }
    }


    var el = createElement('a', {
        'class': 'item',
        target: '_blank',
        styles: sobj,
        html: item
    });
    el.addEventListener('click', click);
    el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        rightClick(url);
    });
    return el;

}


// Recent History

function recentHistory() {

    var ir = 0;
    var rh = '';
    var rhin = localStorage['rh-itemsno'] * 1;
    var rhino = rhin;
    rhin = rhin * 4;

    if (rhin > 0) {

        chrome.history.search({ text: '', maxResults: rhin, startTime: (new Date()).getTime() - (28 * 24 * 3600 * 1000), endTime: (new Date()).getTime() }, function (hi) {

            if (hi.length > 0) {

                for (i = 0; i <= hi.length; i++) {

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

    var itemsno = localStorage['rct-itemsno'] * 1;

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

function showRecentTabs() {
    if (typeof messageAdapter !== 'undefined') {
        Promise.all([
            messageAdapter.getBackgroundData('openedTabs'),
            messageAdapter.getBackgroundData('recentTabs')
        ]).then(([rhhistory, rt]) => {
            showRecentTabsImpl(rhhistory, rt);
        }).catch(err => {
            console.error('Failed to get tab data:', err);
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

    // chrome.tabs.get( id , function (tabs) {
    //     if (tabs.length > 0) {
    //         chrome.windows.update(tabs[0].windowId, { focused: true }, function () {
    //             chrome.tabs.update(tabs[0].id, { active: true } );
    //         });
    //     } else {
    //         console.log("showRecentTabs() openTab error, id="+id);
    //     }
    // });



    var itemsno = localStorage['rt-itemsno'] * 1;
    var rcti = 0;

    if (itemsno > 0) {

        for (i = 0; i < rt.length; i++) {

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
        var itemsno = localStorage['mv-itemsno'] * 1;
        var mvrl = localStorage['mv-blocklist'];
        var r = 0;

        for (i = 0; i < 45; i++) {

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

    var rbin = localStorage['rb-itemsno'] * 1;

    if (rbin > 0) {

        chrome.bookmarks.getRecent(rbin, function (bm) {

            if (bm.length > 0) {

                for (i = 0; i <= bm.length; i++) {

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

        for (i = 0; i < 99; i++) {

            if (pd[i] !== undefined) {
                $('pi-inject').appendChild(formatItem({ type: 'pi', url: pd[i].url, favicon: pd[i].favicon, title: pd[i].title, time: pd[i].time }));
            }

        }

    }

}


// Alert user history

function alertUserHistory(pm) {
    if ($('alert-holder').style.display == 'block') {
        $('alert-holder').style.display = 'none';
        $('alert-holder-loading').style.marginTop = '-15px';
    } else if ($('alert-holder').style.display == 'none') {
        $('alert-holder').style.display = 'block';
    }
}

function alertLoadingHistory(pm) {
    if (pm) {
        $('alert-holder').style.display = 'none';
        $('alert-holder-loading').style.marginTop = '-15px';
    } else if ($('alert-holder').style.display == 'none') {
        $('alert-holder').style.display = 'block';
    }
}


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


function showCalendar() {
    var cal = document.querySelector('#calendar');
    if (cal) {
        if (cal.style.display == 'none') {
            cal.style.display = 'inline';
        } else {
            cal.style.display = 'none';
        }
    }
}

// Date picker

function calendar(w, e) {

    if (isLeapYear()) {
        var dayarray = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    } else {
        var dayarray = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    }

    if (w == 'current') {
        var cdateo = new Date();
    } else if ('selected') {
        var monthSelect = $('date-select-month');
        var daySelect = $('date-select-day');
        var yearSelect = $('date-select-year');
        var mcheck = dayarray[(monthSelect.options[monthSelect.selectedIndex].value * 1 - 1)];
        var dcheck = (daySelect.options[daySelect.selectedIndex].value * 1);
        if (mcheck < dcheck) {
            var cdateo = new Date((yearSelect.options[yearSelect.selectedIndex].value * 1), (monthSelect.options[monthSelect.selectedIndex].value * 1 - 1), mcheck, 23, 59, 59, 999);
        } else {
            var cdateo = new Date((yearSelect.options[yearSelect.selectedIndex].value * 1), (monthSelect.options[monthSelect.selectedIndex].value * 1 - 1), (daySelect.options[daySelect.selectedIndex].value * 1), 23, 59, 59, 999);
        }
    }

    if (e == 'prev') {
        cdateo.setDate(cdateo.getDate() - 1);
    } else if (e == 'next') {
        cdateo.setDate(cdateo.getDate() + 1);
    }

    $('date-select-day').innerHTML = '';
    var ydatec = new Date().getFullYear();
    var mdatec = cdateo.getMonth();
    var ddatec = cdateo.getDate();
    var yeararray = [ydatec, (ydatec - 1)];

    if (w == 'current') {
        for (i = 0; i < yeararray.length; i++) {
            var opt = createElement('option', { 'value': yeararray[i], 'text': yeararray[i] });
            if (i == 0) {
                opt.selected = true;
            }
            $('date-select-year').appendChild(opt);
        }
    }

    var monthOptions = $$('#date-select-month option');
    for (var mi = 0; mi < monthOptions.length; mi++) {
        if ((mdatec) + 1 == (monthOptions[mi].value * 1)) {
            monthOptions[mi].selected = true;
        }
    }

    for (i = 0; i <= dayarray.length; i++) {
        if (mdatec == i) {
            for (ia = 1; ia <= dayarray[i]; ia++) {
                var iaStr = ia + '';
                if (iaStr.length == 1) {
                    iaStr = '0' + iaStr;
                }
                var opt = createElement('option', { 'value': iaStr, 'text': iaStr });
                if (ia == ddatec) {
                    opt.selected = true;
                }
                $('date-select-day').appendChild(opt);
            }
        }
    }

    var fday = new Date(ydatec, mdatec, 1, 23, 59, 59, 999).getDay();
    var lday = new Date(ydatec, mdatec, dayarray[mdatec], 23, 59, 59, 999).getDay();

    $('calendar-days').textContent = '';

    for (ii = 0; ii < dayarray[mdatec]; ii++) {
        if (ii == 0) {
            for (d = 0; d < fday; d++) {
                $('calendar-days').appendChild(createElement('span', { html: '&nbsp;', 'class': 'day' }));
            }
        }
        if ((ii + 1) == ddatec) {
            var dayLink = createElement('a', {
                id: 'selected',
                href: '#',
                rel: (ii + 1) + '|' + (mdatec + 1) + '|' + ydatec,
                text: (ii + 1),
                'class': 'day'
            });
            dayLink.addEventListener('click', function () {
                var cel = this;
                var dayOptions = $$('#date-select-day option');
                for (var di = 0; di < dayOptions.length; di++) {
                    if (parseInt(dayOptions[di].value, 10) == parseInt(cel.textContent, 10)) {
                        dayOptions[di].selected = true;
                    } else {
                        dayOptions[di].selected = false;
                    }
                }
                var selectedLink = document.querySelector('#calendar-days a#selected');
                if (selectedLink) selectedLink.removeAttribute('id');
                cel.id = 'selected';
                history('yes', '');
            });
            $('calendar-days').appendChild(dayLink);
        } else {

            let _time = new Date(ydatec, mdatec, ii, 23, 59, 59, 999).getTime();
            // -86400000
            let rhat = calendar_storage2[_time];
            let style = '';

            if (rhat == undefined) {

            } else if (rhat > 0 && rhat < 50) {
                style = ('background-color:#daf3cb');
            } else if (rhat > 49 && rhat < 100) {
                style = ('background-color:#aade8a');
            } else if (rhat > 99 && rhat < 150) {
                style = ('background-color:#6dc738');
            } else if (rhat >= 150) {
                style = ('background-color:#4e991f');
            }


            var dayLink = createElement('a', {
                href: '#',
                text: (ii + 1),
                'class': 'day',
                'style': style
            });
            dayLink.addEventListener('click', function () {
                var cel = this;
                var dayOptions = $$('#date-select-day option');
                for (var di = 0; di < dayOptions.length; di++) {
                    if (parseInt(dayOptions[di].value, 10) == parseInt(cel.textContent, 10)) {
                        dayOptions[di].selected = true;
                    } else {
                        dayOptions[di].selected = false;
                    }
                }
                var selectedLink = document.querySelector('#calendar-days a#selected');
                if (selectedLink) selectedLink.removeAttribute('id');
                cel.id = 'selected';
                history('yes', '');
            });
            $('calendar-days').appendChild(dayLink);
        }
        if ((ii + 1) == dayarray[mdatec]) {
            for (d = 0; d < (6 - lday); d++) {
                $('calendar-days').appendChild(createElement('span', { html: '&nbsp;', 'class': 'day' }));
            }
        }
    }

}




// History

function history(w, q) {

    var sw = $('rh-what').options[$('rh-what').selectedIndex].value;
    var grp = localStorage['rh-group'];
    var oby = localStorage['rh-orderby'];
    var ord = localStorage['rh-order'];
    var obj = {};
    var rha = [];
    var test = {};

    if (prh) {
        clearInterval(prh);
    }

    if (w == 'yes' || w == 'current') {
        if (w == 'yes') {
            var day = ($('date-select-day').options[$('date-select-day').selectedIndex].value * 1);
            var month = ($('date-select-month').options[$('date-select-month').selectedIndex].value * 1 - 1);
            var year = ($('date-select-year').options[$('date-select-year').selectedIndex].value * 1);
            var today = new Date(year, month, day, 23, 59, 59, 999);
        } else if (w == 'current') {
            var ndc = new Date();
            var today = new Date(ndc.getFullYear(), ndc.getMonth(), ndc.getDate(), 23, 59, 59, 999);
        }
        var eTime = today.getTime();
        obj['startTime'] = (eTime - 86400000);
        obj['endTime'] = today.getTime();
        obj['maxResults'] = 9999;
        obj['text'] = '';
        var into = 'rh-views-insert';
        $('rh-views-search-insert').style.display = 'none';
        $('rh-views-insert').style.display = 'block';
        $('rh-search').value = '';
        $('delete-range-one').value = formatDate(eTime);
        $('delete-range-two').value = formatDate(eTime);
    } else if (w == 'search') {
        if (sw == 'current') {
            var day = ($('date-select-day').options[$('date-select-day').selectedIndex].value * 1);
            var month = ($('date-select-month').options[$('date-select-month').selectedIndex].value * 1 - 1);
            var year = ($('date-select-year').options[$('date-select-year').selectedIndex].value * 1);
            var ndate = new Date(year, month, day, 23, 59, 59, 999);
            var eTime = ndate.getTime();
            var sTime = (eTime - 86400000);
            obj['startTime'] = sTime;
            obj['endTime'] = ndate.getTime();
        } else if (sw == 'all') {
            obj['startTime'] = (new Date()).getTime() - (28 * 24 * 3600 * 1000);
            obj['endTime'] = (new Date()).getTime();
        } else if (sw == 'recent') {
            // Do not set anything
        }
        obj['text'] = q;
        obj['maxResults'] = 100;
        var into = 'rh-views-search-insert';
        $('rh-views-search-insert').style.display = 'block';
        $('rh-views-insert').style.display = 'none';
    }

    $(into).textContent = returnLang('loading');

    chrome.history.search(obj, function (hi) {

        console.log("search obj=" + obj['text']);

        if (hi.length > 0) {

            alertLoadingHistory(false);

            for (i = 0; i <= hi.length; i++) {

                if (hi[i] !== undefined && (/^(http|https|ftp|ftps)\:\/\//).test(hi[i].url)) {

                    if (filtUrl(hi[i].url) == false) {

                        var title = hi[i].title;
                        var url = hi[i].url;
                        var visits = hi[i].visitCount;
                        var furl = getFaviconUrl(hi[i].url);

                        if (title == '') {
                            title = url;
                        }

                        if (hi[i].lastVisitTime >= obj['startTime'] && hi[i].lastVisitTime <= obj['endTime']) {
                            //   rha.push({epoch: hi[i].lastVisitTime, url: url, host: (new URI(url).get('host')), time: timeNow(hi[i].lastVisitTime), date: formatDate(hi[i].lastVisitTime), favicon: furl, title: truncate(title_fix(title), 0, 100), visits: visits});
                            rha.push({ epoch: hi[i].lastVisitTime, url: url, host: get_host(url), time: TimeToStr(hi[i].lastVisitTime, true, true, false), date: formatDate(hi[i].lastVisitTime), favicon: furl, title: truncate(title_fix(title), 0, 100), visits: visits });

                        }

                    }

                }

            }

            if (rha.length > 0) {

                $('master-check-all').disabled = true;

                if (into == 'rh-views-insert') {
                    var rhat = rha.length;
                    $('calendar-total-value').textContent = rhat;
                    if (rhat == 0 || rhat < 50) {
                        var selLink = document.querySelector('#calendar a#selected');
                        if (selLink) selLink.style.backgroundColor = '#daf3cb';
                    } else if (rhat > 49 && rhat < 100) {
                        var selLink = document.querySelector('#calendar a#selected');
                        if (selLink) selLink.style.backgroundColor = '#aade8a';
                    } else if (rhat > 99 && rhat < 150) {
                        var selLink = document.querySelector('#calendar a#selected');
                        if (selLink) { selLink.style.backgroundColor = '#6dc738'; selLink.style.color = '#fff'; }
                    } else {
                        var selLink = document.querySelector('#calendar a#selected');
                        if (selLink) { selLink.style.backgroundColor = '#4e991f'; selLink.style.color = '#fff'; }
                    }
                }


                save_calendar_storage2(obj, rha.length, true);

                if (oby == 'title') {
                    rha.sort(function (a, b) {
                        if (grp == 'yes') {
                            var nameA = a.host.replace('www.', '');
                            var nameB = b.host.replace('www.', '');
                        } else if (grp == 'no') {
                            var nameA = a.title;
                            var nameB = b.title;
                        }
                        if (nameA < nameB) {
                            return -1;
                        } else if (nameA > nameB) {
                            return 1;
                        } else {
                            return 0;
                        }
                    });
                } else {
                    rha.sort(function (a, b) {
                        return a.epoch - b.epoch;
                    });
                    rha.reverse();
                }

                if (ord == 'asc') {
                    rha.reverse();
                }

                $(into).textContent = '';

                var ibcv = 'grey';
                var Counter = { counter: 0 };

                if (grp == 'yes') {  // 注意此处回调耗时操作
                    prh = setInterval(function () {
                        var thisc = Counter;
                        if (thisc.counter == rha.length) {
                            clearInterval(prh);
                            //isBookmarked('#rh-views .item .link');
                            alertLoadingHistory(true);
                            var input = document.body.querySelector('#rh-bar-uione input');
                            if (input) input.checked = false;
                            selectedItem = undefined;
                            if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].getAttribute('title')); }
                            $('master-check-all').removeAttribute('disabled');
                        } else {
                            if (rha[thisc.counter] !== undefined) {
                                if (!$(into).querySelector('div[rel="' + rha[thisc.counter].host + '"]')) {
                                    var toggleid = 'toggle-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var moreid = 'more-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var groupid = 'group-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var faviconSrc = rha[thisc.counter].favicon ? 'src="' + rha[thisc.counter].favicon + '"' : '';
                                    var groupDiv = createElement('div', {
                                        title: rha[thisc.counter].host,
                                        rel: ibcv,
                                        'class': 'item-holder group-title ',
                                        html: '<a href="#" class="group-title-toggle" id="' + toggleid + '" data-host="' + rha[thisc.counter].host + '" rel="' + rha[thisc.counter].host + '"></a><input type="checkbox" class="group-title-checkbox" id="' + moreid + '" value="' + rha[thisc.counter].host + '"><img id="' + errorid + '" class="group-title-favicon" alt="Favicon" ' + faviconSrc + '><span id="' + groupid + '" data-host="' + rha[thisc.counter].host + '" class="group-title-host">' + rha[thisc.counter].host.replace('www.', '') + '</span>'
                                    });
                                    $(into).appendChild(groupDiv);
                                    $(toggleid).addEventListener('click', function () {
                                        var host = this.getAttribute('data-host');
                                        toggleGroup(host);
                                    });
                                    $(moreid).addEventListener('click', function () {
                                        getMoreItems(this);
                                    });
                                    $(errorid).addEventListener('error', function () {
                                        this.src = 'images/blank.png';
                                    });
                                    $(groupid).addEventListener('click', function () {
                                        var host = this.getAttribute('data-host');
                                        toggleGroup(host);
                                    });
                                    var holderDiv = createElement('div', { 'class': 'group-holder', rel: rha[thisc.counter].host, styles: { 'display': 'none' } });
                                    $(into).appendChild(holderDiv);
                                    if (ibcv == 'white') {
                                        ibcv = 'grey';
                                    } else {
                                        ibcv = 'white';
                                    }
                                }
                                if (w == 'search' && (sw == 'all' || sw == 'recent')) {
                                    //                    rha[thisc.counter].time = '- - : - -';
                                }
                                var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var item;
                                item = '<div class="item">';
                                item += '<span class="checkbox"><label><input class="chkbx" type="checkbox" id="' + selectid + '" value="' + rha[thisc.counter].url + '" name="check"></label>&nbsp;</span>';
                                //item += '<span class="bookmark">&nbsp;</span>';
                                item += '<span class="time">' + rha[thisc.counter].time + '</span>';
                                item += '<a style="padding-left:0;" target="_blank" class="link" href="' + rha[thisc.counter].url + '">';
                                item += '<span class="title" title="' + rha[thisc.counter].url + '" rel="' + returnLang('visits') + ': ' + rha[thisc.counter].visits + ' | ' + rha[thisc.counter].time + ' ' + rha[thisc.counter].date + '">' + rha[thisc.counter].title + '</span>';
                                item += '</a>';
                                item += '</div>';
                                var parentHolder = $(into).querySelector('div.item-holder[title="' + rha[thisc.counter].host + '"]');
                                var relVal = parentHolder ? parentHolder.getAttribute('rel') : ibcv;
                                var bgColor = parentHolder ? parentHolder.style.backgroundColor : '';
                                var itemHolder = createElement('div', {
                                    'rel': relVal,
                                    'class': 'item-holder',
                                    styles: {
                                        'backgroundColor': bgColor
                                    }
                                });
                                itemHolder.innerHTML = item + '<div class="clearitem" style="clear:both;"></div>';
                                var groupHolder = $(into).querySelector('div[rel="' + rha[thisc.counter].host + '"]');
                                if (groupHolder) {
                                    groupHolder.appendChild(itemHolder);
                                } else {
                                    $(into).appendChild(itemHolder);
                                }
                                $(selectid).addEventListener('click', function () {
                                    selectHistoryItem(this, 'single');
                                });
                            }
                        }
                        thisc.counter++;
                    }.bind(Counter), 5);
                } else if (grp == 'no') {
                    prh = setInterval(function () {
                        var thisc = Counter;
                        if (thisc.counter == rha.length) {
                            clearInterval(prh);
                            //isBookmarked('#rh-views .item .link');
                            alertLoadingHistory(true);
                            var input = document.body.querySelector('#rh-bar-uione input');
                            if (input) input.checked = false;
                            selectedItem = undefined;
                            if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].getAttribute('title')); }
                            $('master-check-all').removeAttribute('disabled');
                        } else {
                            if (rha[thisc.counter] !== undefined) {
                                if (w == 'search' && (sw == 'all' || sw == 'recent')) {
                                    // rha[thisc.counter].time = '- - : - -';
                                }
                                var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var faviconSrc = rha[thisc.counter].favicon ? 'src="' + rha[thisc.counter].favicon + '"' : '';
                                var item;
                                item = '<div class="item">';
                                item += '<span class="checkbox"><label><input class="chkbx" type="checkbox" id="' + selectid + '" value="' + rha[thisc.counter].url + '" name="check"></label>&nbsp;</span>';
                                //item += '<span class="bookmark">&nbsp;</span>';
                                item += '<span class="time">' + rha[thisc.counter].time + '</span>';
                                item += '<a target="_blank" class="link" href="' + rha[thisc.counter].url + '">';
                                item += '<img id="' + errorid + '" class="favicon" alt="Favicon" ' + faviconSrc + '">';
                                item += '<span class="title" title="' + rha[thisc.counter].url + '" rel="' + returnLang('visits') + ': ' + rha[thisc.counter].visits + ' | ' + rha[thisc.counter].time + ' ' + rha[thisc.counter].date + '">' + rha[thisc.counter].title + '</span>';
                                item += '</a>';
                                item += '</div>';
                                var itemHolder = createElement('div', { 'rel': ibcv, 'class': 'item-holder ' });
                                itemHolder.innerHTML = item + '<div class="clearitem" style="clear:both;"></div>';
                                $(into).appendChild(itemHolder);

                                if (ibcv == 'white') {
                                    ibcv = 'grey';
                                } else {
                                    ibcv = 'white';
                                }
                                $(selectid).addEventListener('click', function () {
                                    selectHistoryItem(this, 'single');
                                });
                                $(errorid).addEventListener('error', function () {
                                    this.src = 'images/blank.png';
                                });
                            }
                        }
                        thisc.counter++;
                    }.bind(Counter), 5);
                }
                alertLoadingHistory(true);
            } else {
                alertLoadingHistory(true);
                $('calendar-total-value').textContent = '0';
                $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
            }

            //            alertLoadingHistory(true);
        } else {
            $('calendar-total-value').textContent = '0';
            $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
        }

    });

}


// Toggle group

function toggleGroup(host) {
    if (getActiveHistory() == 'history') {
        var into = 'rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        var into = 'rh-views-search-insert';
    }
    var tgda = $(into).querySelector('a[rel="' + host + '"]');
    var tgde = $(into).querySelector('div[rel="' + host + '"]');

    if (tgda != undefined && tgde != undefined) {
        var tgdv = tgde.style.display;
        if (tgdv == 'block') {
            tgde.style.display = 'none';
            tgda.style.backgroundPosition = 'left center';
        } else {
            tgde.style.display = 'block';
            tgda.style.backgroundPosition = 'right center';
        }
    } else {
        console.log('error: toggleGroup(' + host + ')');
    }

}


// Get active history

function getActiveHistory() {
    if ($('rh-views-insert').style.display == 'block') {
        return 'history';
    } else if ($('rh-views-search-insert').style.display == 'block') {
        return 'search';
    }
}


// Get more items

function getMoreItems(el) {
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        var into = '#rh-views-search-insert';
    }
    var ihost = el.value;
    if (el.checked == false) {
        Array.from($$(into + ' .chkbx')).forEach(function (ele) {
            var eleh = get_host(ele.value);
            if (ihost == eleh) {
                ele.checked = false;
                var parentHolder = ele.closest('div.item-holder');
                if (parentHolder && parentHolder.getAttribute('rel') == 'white') {
                    parentHolder.style.backgroundColor = '#fff';
                    el.closest('div.group-title').style.backgroundColor = '#fff';
                } else {
                    if (parentHolder) parentHolder.style.backgroundColor = '#f1f1f1';
                    el.closest('div.group-title').style.backgroundColor = '#f1f1f1';
                }
            }
        });
    } else if (el.checked == true) {
        Array.from($$(into + ' .chkbx')).forEach(function (ele) {
            var eleh = get_host(ele.value);
            if (ihost == eleh) {
                ele.checked = true;
                el.closest('div.group-title').style.backgroundColor = itemSelectedColor;
                selectHistoryItem(ele, 'single');
            }
        });
    }
    if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
        $('master-check-all').checked = true;
        $('master-check-all').value = 'true';
    } else {
        $('master-check-all').checked = false;
        $('master-check-all').value = 'false';
    }
}


// Reset color

function resetColor() {
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        var into = '#rh-views-search-insert';
    }
    Array.from($$(into + ' .item-holder')).forEach(function (el) {
        if (el.getAttribute('rel') == 'grey') {
            el.style.backgroundColor = '#f1f1f1';
        } else if (el.getAttribute('rel') == 'white') {
            el.style.backgroundColor = '#fff';
        }
        var chkInput = el.querySelector('input.chkbx');
        if (chkInput && chkInput.checked == true) {
            el.style.backgroundColor = itemSelectedColor;
        }
    });
}


// Select history item

function selectHistoryItem(el, w) {
    var grp = localStorage['rh-group'];
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        var into = '#rh-views-search-insert';
    }
    if (w == 'single') {
        if (el.checked == true) {
            if (shiftState == 'true' && selectedItem !== undefined) {
                var hitState = 'false';
                var chkbxs = $$(into + ' .chkbx');
                for (i = 0; i < chkbxs.length; i++) {
                    if (chkbxs[i] == el || chkbxs[i] == selectedItem) {
                        if (hitState == 'false') {
                            hitState = 'true';
                        } else if (hitState == 'true') {
                            hitState = 'false';
                        }
                    }
                    if (hitState == 'true' && chkbxs[i] !== el && chkbxs[i] !== selectedItem) {
                        if (chkbxs[i].checked == true) {
                            chkbxs[i].checked = false;
                            var parentHolder = chkbxs[i].closest('div.item-holder');
                            if (parentHolder && parentHolder.getAttribute('rel') == 'white') {
                                parentHolder.style.backgroundColor = '#fff';
                            } else {
                                if (parentHolder) parentHolder.style.backgroundColor = '#f1f1f1';
                            }
                        } else if (chkbxs[i].checked == false) {
                            chkbxs[i].checked = true;
                            chkbxs[i].closest('div.item-holder').style.backgroundColor = itemSelectedColor;
                        }
                    }
                }
            }
            selectedItem = el;
            el.closest('div.item-holder').style.backgroundColor = itemSelectedColor;
        } else if (el.checked == false) {
            selectedItem = undefined;
            var iurl = el.value;
            Array.from($$(into + ' .chkbx')).forEach(function (ele) {
                if (ele.value == iurl) {
                    var parentHolder = ele.closest('div.item-holder');
                    if (parentHolder && parentHolder.getAttribute('rel') == 'white') {
                        parentHolder.style.backgroundColor = '#fff';
                    } else {
                        if (parentHolder) parentHolder.style.backgroundColor = '#f1f1f1';
                    }
                }
            });
        }
        if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
            $('master-check-all').checked = true;
            $('master-check-all').value = 'true';
        } else {
            $('master-check-all').checked = false;
            $('master-check-all').value = 'false';
        }
        if (grp == 'yes') {
            var elem = el.closest('.group-holder');
            if (elem) {
                var chkbxCount = elem.querySelectorAll('.chkbx').length;
                var chkbxChecked = elem.querySelectorAll('.chkbx:checked').length;
                if (chkbxCount == chkbxChecked) {
                    var titleDivs = $$(into + ' div[title="' + elem.getAttribute('rel') + '"]');
                    if (titleDivs.length > 0) {
                        titleDivs[0].style.backgroundColor = itemSelectedColor;
                        var chkBox = titleDivs[0].querySelector('.group-title-checkbox');
                        if (chkBox) chkBox.checked = true;
                    }
                } else {
                    var titleDivs = $$(into + ' div[title="' + elem.getAttribute('rel') + '"]');
                    if (titleDivs.length > 0) {
                        if (titleDivs[0].getAttribute('rel') == 'grey') {
                            titleDivs[0].style.backgroundColor = '#f1f1f1';
                            var chkBox = titleDivs[0].querySelector('.group-title-checkbox');
                            if (chkBox) chkBox.checked = false;
                        } else if (titleDivs[0].getAttribute('rel') == 'white') {
                            titleDivs[0].style.backgroundColor = '#fff';
                            var chkBox = titleDivs[0].querySelector('.group-title-checkbox');
                            if (chkBox) chkBox.checked = false;
                        }
                    }
                }
            }
        }
    } else if (w == 'all') {
        if (el.value == 'false') {
            Array.from($$(into + ' .chkbx')).forEach(function (ele) {
                ele.checked = true;
                ele.closest('div.item-holder').style.backgroundColor = itemSelectedColor;
            });
            if (grp == 'yes') {
                Array.from($$(into + ' .group-title')).forEach(function (gel) {
                    var chkInput = gel.querySelector('input');
                    if (chkInput) chkInput.checked = true;
                    gel.style.backgroundColor = itemSelectedColor;
                });
            }
            el.value = 'true';
        } else {
            Array.from($$(into + ' .chkbx')).forEach(function (ele) {
                ele.checked = false;
                var parentHolder = ele.closest('div.item-holder');
                if (parentHolder && parentHolder.getAttribute('rel') == 'white') {
                    parentHolder.style.backgroundColor = '#fff';
                } else {
                    if (parentHolder) parentHolder.style.backgroundColor = '#fafafa';
                }
            });
            if (grp == 'yes') {
                Array.from($$(into + ' .group-title')).forEach(function (gel) {
                    var chkInput = gel.querySelector('input');
                    if (chkInput) chkInput.checked = false;
                    if (gel.getAttribute('rel') == 'white') {
                        gel.style.backgroundColor = '#fff';
                    } else {
                        gel.style.backgroundColor = '#fafafa';
                    }
                });
            }
            el.value = 'false';
        }
    }
}


// Delete history item

function deleteHistoryItem(w) {
    if (w == 'selected') {
        var grp = localStorage['rh-group'];
        if (getActiveHistory() == 'history') {
            var into = '#rh-views-insert';
        } else if (getActiveHistory() == 'search') {
            var into = '#rh-views-search-insert';
        }
        if ($$(into + ' .checkbox input:checked').length > 0) {
            document.title = 'Deleting...';
            alertLoadingHistory(true);
            Array.from($$(into + ' .checkbox input:checked')).forEach(function (el) {
                el.closest('div.item-holder').remove();
                chrome.history.deleteUrl({ url: el.value });
            });
            chrome.history.search({ text: '', maxResults: 1, startTime: (new Date()).getTime() - (1 * 24 * 3600 * 1000), endTime: (new Date()).getTime() }, function (hi) {
                if (grp == 'yes') {
                    Array.from($$(into + ' .group-holder')).forEach(function (gel) {
                        if (gel.querySelectorAll(':scope > div.item-holder').length == 0) {
                            var groupTitle = document.querySelector(into + ' .group-title[title="' + gel.getAttribute('rel') + '"]');
                            if (groupTitle) groupTitle.remove();
                            gel.remove();
                        }
                    });
                }
                document.title = 'History | Recent History';
                alertLoadingHistory(true);
            });
        }
    } else if (w == 'range') {
        var dober = {};
        var dobsr = {};
        var df = localStorage['rh-date'];
        var dfs = df.split('/');
        var sr = $('delete-range-one').value.split('/');
        var er = $('delete-range-two').value.split('/');
        for (d = 0; d < dfs.length; d++) {
            dobsr[dfs[d]] = sr[d];
            dober[dfs[d]] = er[d];
        }
        var startRange = new Date(dobsr['yyyy'], (dobsr['mm'] - 1), dobsr['dd'], 23, 59, 59, 999).getTime() - 86400000;
        var endRange = new Date(dober['yyyy'], (dober['mm'] - 1), dober['dd'], 23, 59, 59, 999).getTime();
        if (startRange < endRange) {
            document.title = 'Deleting...';
            alertUserHistory(true);
            chrome.history.deleteRange({ startTime: startRange, endTime: endRange }, function () {
                calendar('yes', '');
                history('yes', '');
                document.title = 'History | Recent History';
                alertUserHistory(true);
            });
        }
    }
}

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
        return Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : '';
    }

    // 为不同类型的页面设置不同的图标
    if (isBookmarkletUrl(url)) {
        if (Object.prototype.hasOwnProperty.call(options, 'bookmarkletFallback')) {
            return options.bookmarkletFallback;
        }
        return 'images/iconmonstr-script-6.svg';
    }
    
    // 扩展页面
    else if (url.indexOf('extension://') !== -1 || url.indexOf('edge://extensions') !== -1) {
        // 检查是否是本扩展的页面
        try {
            var isOwnExtension = false;
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                isOwnExtension = url.indexOf(chrome.runtime.id) !== -1;
            }
            // 本扩展的页面使用tree-38.png
            return isOwnExtension ? 'images/tree-38.png' : 'images/Extension-icon-vector-04.svg';
        } catch (e) {
            // 如果无法确定，使用通用扩展图标
            return 'images/Extension-icon-vector-04.svg';
        }
    }
    
    // 浏览器自身页面
    else if (url.indexOf('chrome://') === 0 || 
             url.indexOf('about:') === 0 || 
             url.indexOf('edge://') === 0 || 
             url.indexOf('opera://') === 0 ||
             url.indexOf('brave://') === 0) {
        return 'images/Browser-icon-vector-03.svg';
    }
    
    // 本地文件
    else if (url.indexOf('file://') === 0) {
        return 'images/iconmonstr-file-3.svg';
    }

    var service = localStorage['favicon-service'] || defaultValues['favicon-service'];
    var trimmedUrl = url.trim();

    if (!trimmedUrl) {
        return Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : '';
    }

    var hostValue = '#';
    try {
        hostValue = get_host(trimmedUrl);
    } catch (err) {
        hostValue = '#';
    }

    if (service === 'chrome') {
        if (hostValue === '#') {
            return 'chrome://favicon/';
        }
        return 'chrome://favicon/' + trimmedUrl;
    }

    var parsedUrl = null;
    try {
        parsedUrl = new URL(trimmedUrl);
    } catch (err) {
        try {
            parsedUrl = new URL('https://' + trimmedUrl);
        } catch (err2) {
            parsedUrl = null;
        }
    }

    var fallback = Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : 'images/blank.png';

    if (!parsedUrl || hostValue === '#') {
        return fallback;
    }

    var protocol = parsedUrl.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
        return fallback;
    }

    var hostname = parsedUrl.hostname;
    if (!hostname) {
        return fallback;
    }

    if (service === 'google') {
        return 'https://www.google.com/s2/favicons?sz=64&domain_url=' + encodeURIComponent(parsedUrl.origin + '/');
    }

    if (service === 'duckduckgo') {
        return 'https://icons.duckduckgo.com/ip3/' + hostname + '.ico';
    }

    return 'chrome://favicon/' + trimmedUrl;
}

// DOM functions

document.addEventListener('DOMContentLoaded', function () {

    // Display language strings

    Array.from($$('.lang')).forEach(function (el) {
        el.innerHTML = returnLang(el.getAttribute('data-lang-string'));
    });

    // Href hashes

    setInterval(function () {
        Array.from($$('a[href="#"]')).forEach(function (el) {
            if (el.classList.contains('hrefhash')) {
                // Do nothing
            } else {
                el.addEventListener('click', function (el) {
                    return false;
                });
                el.classList.add('hrefhash');
            }
        });
    }, 250);

});
