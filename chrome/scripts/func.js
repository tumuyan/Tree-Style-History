// Version

function getVersion() {
    return '3.1.12';
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
var calendar_storage2_str = localStorage['calendar-storage2'];
if (calendar_storage2_str != undefined) {
    calendar_storage2 = JSON.parse(calendar_storage2_str);
}

function save_calendar_storage2(obj, n, f) {
    if (obj['text'] == '' && obj['maxResults'] >= 9999 && obj['endTime'] - 86400000 == obj['startTime']) {
        if ((obj['startTime'] - _DATE + 1) % 86400000 == 0) {
            if (f || calendar_storage2[obj['startTime']] == undefined || calendar_storage2[obj['startTime']] < 1) {
                calendar_storage2[obj['startTime']] = n;
                console.log('n=' + n);
                localStorage['calendar-storage2'] = JSON.encode(calendar_storage2);
            }
        }
    }
}
// Popup scrollbar fix

function popup_scrollbar_fix() {
    var ps = $(document.body).getSize().y;
    var pss = $(document.body).getScrollSize().y;
    if (pss > ps) {
        $('popup').setStyle('margin-right', '24px');
    } else {
        $('popup').setStyle('margin-right', '5px');
    }
}


function title_fix(text) {
    return text.stripScripts().replace(/\"/g, '&#34;').replace(/\</g, '').replace(/\>/g, '').replace(/\//g, '');
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
    var year = $('date-select-year').getSelected().get('value') * 1;
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

    new Event(event).stop();

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
    "show-popup": "yes"
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
    $('save').set('value', returnLang('saveOptions'));
    $$('.help-tip').each(function (el) {
        el.set('title', returnLang(el.get('id')));
    });
    new Tips('.help-tip', {
        className: 'custom_tip'
    });
}


// Load options

function loadOptions(full) {

    $('rhitemsno').set('value', localStorage['rh-itemsno']);
    $('rctitemsno').set('value', localStorage['rct-itemsno']);
    $('rtitemsno').set('value', localStorage['rt-itemsno']);
    $('mvitemsno').set('value', localStorage['mv-itemsno']);
    $('rbitemsno').set('value', localStorage['rb-itemsno']);

    var rhilo_default = defaultValues["rh-list-order"].split(',');
    var rhilo = localStorage['rh-list-order'].split(',');

    for (var lo in rhilo_default) {
        if (rhilo.indexOf(rhilo_default[lo]) < 0)
            rhilo.push(rhilo_default[lo]);
    }

    $('rhlistorder').empty();

    for (var lo in rhilo) {
        if (rhilo[lo] == 'rh-order') {
            new Element('li', { 'id': rhilo[lo], 'html': returnLang('recentHistory') }).inject('rhlistorder');
        } else if (rhilo[lo] == 'rct-order') {
            new Element('li', { 'id': rhilo[lo], 'html': returnLang('recentlyClosedTabs') }).inject('rhlistorder');
        } else if (rhilo[lo] == 'mv-order') {
            new Element('li', { 'id': rhilo[lo], 'html': returnLang('mostVisited') }).inject('rhlistorder');
        } else if (rhilo[lo] == 'rb-order') {
            new Element('li', { 'id': rhilo[lo], 'html': returnLang('recentBookmarks') }).inject('rhlistorder');
        } else if (rhilo[lo] == 'rt-order') {
            new Element('li', { 'id': rhilo[lo], 'html': returnLang('recentTabs') }).inject('rhlistorder');
        }
    }


    var rhos = new Sortables('#rhlistorder', {
        onStart: function (el) {
            $$('#rhlistorder li').each(function (els) {
                if (els !== el) {
                    els.setStyle('opacity', .4);
                }
            });
        },
        onComplete: function (el) {
            $$('#rhlistorder li').setStyle('opacity', 1);
        }
    });

    
    $$('#showPopup option[value="' + localStorage['show-popup'] + '"]').set('selected','selected');
    $$('#rhhistorypage option[value="' + localStorage['rh-historypage'] + '"]').set('selected', 'selected');
    $$('#rhdate option[value="' + localStorage['rh-date'] + '"]').set('selected', 'selected');
    $$('#rhtime option[value="' + localStorage['rh-timeformat'] + '"]').set('selected', 'selected');
    $$('#rhsearch option[value="' + localStorage['rh-search'] + '"]').set('selected', 'selected');
    $$('#rhshare option[value="' + localStorage['rh-share'] + '"]').set('selected', 'selected');
    $$('#rmpath option[value="' + localStorage['rm-path'] + '"]').set('selected', 'selected');
    $$('#contextmenu option[value="' + localStorage['use-contextmenu'] + '"]').set('selected', 'selected');
    $$('#rhsshowurl option[value="' + localStorage['rhs-showurl'] + '"]').set('selected', 'selected');
    $$('#rhsshowsep option[value="' + localStorage['rhs-showsep'] + '"]').set('selected', 'selected');
    $$('#rhsshowext option[value="' + localStorage['rhs-showext'] + '"]').set('selected', 'selected');
    $$('#rhsshowbg option[value="' + localStorage['rhs-showbg'] + '"]').set('selected', 'selected');
    $$('#lessItem option[value="' + localStorage['less-item'] + '"]').set('selected', 'selected');
    
    previewItem();

    $('rhsshowurl').addEvent('change', function () {
        previewItem();
    });

    $('rhsshowsep').addEvent('change', function () {
        previewItem();
    });

    $('rhsshowext').addEvent('change', function () {
        previewItem();
    });

    $('rhwidth').set('value', localStorage['rh-width'].toInt());

    $('loadrange').set('value', localStorage['load-range'].toInt());
    $('loadrange2').set('value', localStorage['load-range2'].toInt());
    $('loadrange3').set('value', localStorage['load-range3'].toInt());
    $('loadrange4').set('value', localStorage['load-range4'].toInt());

    mostVisitedBlocklist();

    if (full)
        filteredDomainsList();

        $$('#rhclick option[value="' + localStorage['rh-click'] + '"]').set('selected', 'selected');
        $$('#rmclick option[value="' + localStorage['rm-click'] + '"]').set('selected', 'selected');

}



function downloadOptions() {

    chrome.storage.sync.get(null, function (result) {
        $('downloadConfig').set('value', returnLang('saving'));
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
        // $('downloadConfig').set('value', returnLang('downloadConfig'));
    });

}



// Load slider

function loadSlider(id, min, max, current) {
    $(id).setStyle('text-align', 'right');
    var sone = new Slider(id + '-slider', id + '-slider-handle', {
        range: [min, max],
        snap: true,
        initialStep: localStorage[current].toInt(),
        onChange: function (pos) {
            $(id).set('value', pos);
        }
    });
    $(id).addEvent('blur', function () {
        var cval = $(id).get('value') * 1;
        if (cval >= min && cval <= max) {
            sone.set(cval);
        } else {
            $(id).set('value', min);
            sone.set(min);
            alert(min + '-' + max);
        }
    });
    $(id).addEvent('keydown', function (e) {
        if (e.event.keyCode == 40 && ($(id).get('value') * 1) > min) {
            $(id).set('value', ($(id).get('value') * 1) - 1);
            sone.set($(id).get('value'));
        }
    });
    $(id).addEvent('keydown', function (e) {
        if (e.event.keyCode == 38 && ($(id).get('value') * 1) < max) {
            $(id).set('value', ($(id).get('value') * 1) + 1);
            sone.set($(id).get('value'));
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
        $('saveUpload').set('value', returnLang('saving'));
    } else {
        $('save').set('value', returnLang('saving'));
    }

    var mls = [];

    let group = 0;
    let item = 0;
    let cache = '';

    if (mli.length > 0) {
        for (m = 0; m < mli.length; m++) {
            mlil += mli[m].get('text') + '|';
        }
    } else {
        mlil = 'false';
    }

    if (fli.length > 0) {
        for (f = 0; f < fli.length; f++) {
            flil += fli[f].get('text') + '|';

            if (item < 100) {
                cache += fli[f].get('text') + '|';
            } else {
                mls[group] = cache;
                group++;
                item = 0;
                cache = fli[f].get('text') + '|';
            }
        }

        mls[mls.length] = cache;
    } else {
        flil = 'false';
    }

    so['rh-itemsno'] = $('rhitemsno').get('value');
    so['rct-itemsno'] = $('rctitemsno').get('value');
    so['rt-itemsno'] = $('rtitemsno').get('value');
    so['rb-itemsno'] = $('rbitemsno').get('value');
    so['mv-itemsno'] = $('mvitemsno').get('value');
    so['rh-list-order'] = rhlo[0].get('id') + ',' + rhlo[1].get('id') + ',' + rhlo[2].get('id') + ',' + rhlo[3].get('id') + ',' +  rhlo[4].get('id');
    so['rh-historypage'] = $('rhhistorypage').getSelected().get('value');
    so['show-popup'] = $('showPopup').getSelected().get('value');
    so['rh-date'] = $('rhdate').getSelected().get('value');
    so['rh-timeformat'] = $('rhtime').getSelected().get('value');
    so['rh-search'] = $('rhsearch').getSelected().get('value');
    so['rhs-showurl'] = $('rhsshowurl').getSelected().get('value');
    so['rhs-showsep'] = $('rhsshowsep').getSelected().get('value');
    so['rhs-showext'] = $('rhsshowext').getSelected().get('value');
    so['rh-width'] = $('rhwidth').get('value') + 'px';
    so['load-range'] = $('loadrange').get('value');
    so['load-range2'] = $('loadrange2').get('value');
    so['load-range3'] = $('loadrange3').get('value');
    so['load-range4'] = $('loadrange4').get('value');
    so['less-item'] = $('lessItem').getSelected().get('value');
    so['mv-blocklist'] = mlil;
    so['rh-click'] = $('rhclick').getSelected().get('value');
    so['rm-click'] = $('rmclick').getSelected().get('value');
    so['rm-path'] = $('rmpath').getSelected().get('value');
    so['use-contextmenu'] = $('contextmenu').getSelected().get('value');
    so['rh-filtered'] = flil;
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

        (function () {
            console.log('c=' + c + ' mls=' + mls.length + ' so=' + so.length);
            if (c - mls.length == 26)
                $('saveUpload').set('value', returnLang('saved'))
            else
                $('saveUpload').set('value', returnLang('saveFail'))
        }).delay(1500);

        (function () { $('saveUpload').set('value', returnLang('saveUpload')) }).delay(3000);
    } else {
        (function () { $('save').set('value', returnLang('saved')) }).delay(1500);
        (function () { $('save').set('value', returnLang('saveOptions')) }).delay(3000);
    }

    updateFilter();

}


// Preview item

function previewItem() {
    var surl = $('rhsshowurl').getSelected().get('value');
    var ssep = $('rhsshowsep').getSelected().get('value');
    var sext = $('rhsshowext').getSelected().get('value');
    if (surl == 'yes') {
        $('rhitemstyle-url').setStyle('display', 'inline');
    } else {
        $('rhitemstyle-url').setStyle('display', 'none');
    }
    if (ssep == 'yes') {
        $('rhitemstyle').setStyle('border-bottom', '1px solid #ccc');
    } else {
        $('rhitemstyle').setStyle('border-bottom', '0 none');
    }
    if (sext == 'yes') {
        $('rhitemstyle-info').setStyle('display', 'inline');
    } else {
        $('rhitemstyle-info').setStyle('display', 'none');
    }
    if (sext == 'yes' && surl == 'yes') {
        $('rhitemstyle-sep').setStyle('display', 'inline');
    } else {
        $('rhitemstyle-sep').setStyle('display', 'none');
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
                    new Element('tr', { html: '<td><div title="' + mvbl[i] + '">' + mvbl[i] + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' }).inject('mvlist-table');
                    $(linkid).addEvent('click', function () {
                        this.getParent('tr').destroy();
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
                    new Element('tr', { html: '<td><div title="' + fbl[i] + '">' + fbl[i] + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' }).inject('flist-table');
                    $(linkid).addEvent('click', function () {
                        this.getParent('tr').destroy();
                    });
                }
            }
        }
    }
}


// Add filtered item

function addFilteredItem() {
    addList($('flist-add-i').get('value'));
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
            $$('#flist-table tr td:first-child').each(function (el) {
                if (el.get('text') == fliv) {
                    flic = el.get('text');
                }
            });
            if (flic == 'test') {
                var linkid = 'link-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                new Element('tr', { html: '<td><div title="' + fliv + '">' + fliv + '</div></td><td style="width:20px;"><a href="#" id="' + linkid + '"><img alt="Restore" src="images/remove.png"></a></td>', 'class': 'op-item' }).inject('flist-table');
                $('flist-add-i').set('value', '');
                $(linkid).addEvent('click', function () {
                    this.getParent('tr').destroy();
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
                $('popup-search-insert').set('text', '');
                for (i = 0; i <= hi.length; i++) {
                    if (hi[i] !== undefined) {
                        var title = hi[i].title;
                        var url = hi[i].url;
                        var visits = hi[i].visitCount;
                        var furl = 'chrome://favicon/' + hi[i].url;
                        if (title !== '') {
                            formatItem({ type: 'rh', title: title, url: url, favicon: furl, visits: visits }).inject('popup-search-insert');
                        }
                    }
                }
                if (localStorage['rhs-showbg'] == 'yes') {
                    //isBookmarked('#popup-search-insert ');
                    isPinned('#popup-search-insert ');
                }
            } else {
                $('popup-search-insert').set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
            }
        });
    }
}


// Is bookmarked

function isBookmarked(w) {
    $$(w).each(function (el) {
        chrome.bookmarks.search(el.get('href'), function (bms) {
            if (bms.length > 0) {
                for (var i in bms) {
                    if (bms[i].url == el.get('href')) {
                        if (w == '#rh-views .item .link') {
                            if (el.getParent('div.item').getElement('span.bookmark')) {
                                el.getParent('div.item').getElement('span.bookmark').setStyle('background-image', 'url("images/star.png")');
                            }
                        } else {
                            if (el.getStyle('background-color') !== '#ffffbd') {
                                el.setStyle('background-color', '#ffffbd');
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
    $$(w).each(function (el) {
        var pi = JSON.parse(localStorage['rh-pinned']);
        if (pi.length > 0) {
            for (var i in pi) {
                if (pi[i] !== undefined) {
                    if (pi[i].url == el.get('href')) {
                        if (w == '#rh-views .item .link') {
                            if (el.getParent('div.item').getElement('span.pin')) {
                                el.getParent('div.item').getElement('span.pin').setStyle('background-image', 'url("images/pin.png")');
                            }
                        } else {
                            if (el.getStyle('background-color') !== '#f0fff1') {
                                el.setStyle('background-color', '#f0fff1');
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
    if ($$('#' + type + '-inject .edit-items-ui').length > 0) {
        if ($$('#' + type + '-inject .edit-items-ui')[0].getStyle('display') == 'none') {
            $$('#' + type + '-inject .edit-items-ui').setStyle('display', 'inline');
        } else if ($$('#' + type + '-inject .edit-items-ui')[0].getStyle('display') == 'inline') {
            $$('#' + type + '-inject .edit-items-ui').setStyle('display', 'none');
        }
    }
}


// Alert user popup

function alertUser(msg, action) {
    if (action == 'close') {
        $('alert-holder').setStyle('display', 'none');
        $('alert-yes').destroy();
        $('alert-no').destroy();
    } else if (action == 'open') {
        $('alert-holder').setStyle('display', 'block');
        $('alert-text').set('html', msg);
        (function () {
            $('alert-holder').setStyle('display', 'none');
        }).delay(3000);
    }
}


// UI Pin item

function uiPinItem(el, type) {
    alertUser(returnLang('ui1'), 'open');
    $('alert-no').addEvent('click', function () {
        alertUser('', 'close');
    });
    $('alert-yes').addEvent('click', function () {
        var url = el.getParent('a').get('href');
        var title = el.getParent('a').getChildren('span.title').get('text')[0].trim();
        var furl = el.getParent('a').getChildren('img')[0].get('src');
        var time = timeNow(0);
        var pi = localStorage['rh-pinned'];
        if (pi.indexOf('"' + url + '"') == -1) {
            if (pi == 'false') {
                localStorage['rh-pinned'] = JSON.encode([{ url: url, title: title, favicon: furl, time: time }]);
                $('pi-inject').setStyle('display', 'inline');
                if (type == 'rh') {
                    $$('#rh-inject .item').destroy();
                    recentHistory();
                } else if (type == 'rct') {
                    $$('#rct-inject .item').destroy();
                    recentlyClosedTabs();
                } else if (type == 'rt') {
                    $$('#rt-inject .item').destroy();
                    showRecentTabs();
                } else if (type == 'rb') {
                    $$('#rb-inject .item').destroy();
                    recentBookmarks();
                } else if (type == 'mv') {
                    $$('#mv-inject .item').destroy();
                    mostVisited();
                }
                pinned();
                alertUser('', 'close');
            } else {
                pi = JSON.parse(pi);
                pi.unshift({ url: url, title: title, favicon: furl, time: time });
                localStorage['rh-pinned'] = JSON.encode(pi);
                if (type == 'rh') {
                    $$('#rh-inject .item').destroy();
                    recentHistory();
                } else if (type == 'rct') {
                    $$('#rct-inject .item').destroy();
                    recentlyClosedTabs();
                }  else if (type == 'rt') {
                    $$('#rt-inject .item').destroy();
                    showRecentTabs();
                } else if (type == 'rb') {
                    $$('#rb-inject .item').destroy();
                    recentBookmarks();
                } else if (type == 'mv') {
                    $$('#mv-inject .item').destroy();
                    mostVisited();
                }
                $$('#pi-inject .item').destroy();
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
    $('alert-yes').addEvent('click', function () {
        var url = el.getParent('a').get('href');
        if (type == 'rh') {
            chrome.history.deleteUrl({ url: url });
            $$('#rh-inject .item').destroy();
            recentHistory();
            alertUser('', 'close');
        } else if (type == 'rct') {
            var rct = chrome.extension.getBackgroundPage().closedTabs;
            for (var i in rct) {
                if (rct[i] !== undefined && rct[i].url == url) {
                    rct.splice(i, 1);
                    $$('#rct-inject .item').destroy();
                    recentlyClosedTabs();
                    if ($$('#rct-inject .item').length == 0) {
                        $('rct-inject').setStyle('display', 'none');
                    }
                    alertUser('', 'close');
                    break;
                }
            }
        } else if (type == 'rt') {
            console.log("rt ? //todo");
            // var rct = chrome.extension.getBackgroundPage().closedTabs;
            // for (var i in rct) {
            //     if (rct[i] !== undefined && rct[i].url == url) {
            //         rct.splice(i, 1);
            //         $$('#rct-inject .item').destroy();
            //         recentlyClosedTabs();
            //         if ($$('#rct-inject .item').length == 0) {
            //             $('rct-inject').setStyle('display', 'none');
            //         }
            //         alertUser('', 'close');
            //         break;
            //     }
            // }
        } else if (type == 'rb') {
            chrome.bookmarks.search(url, function (bms) {
                if (bms.length > 0) {
                    for (var i in bms) {
                        if (bms[i].url == url) {
                            chrome.bookmarks.remove(bms[i].id, function () {
                                $$('#rb-inject .item').destroy();
                                recentBookmarks();
                                $$('#popup-insert .item').setStyle('background-color', 'transparent');
                                //isBookmarked('#rh-inject .item');
                                isPinned('#rh-inject .item');
                                //isBookmarked('#rct-inject .item');
                                isPinned('#rct-inject .item');
                                if ($$('#rb-inject .item').length == 0) {
                                    $('rb-inject').setStyle('display', 'none');
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
            $$('#mv-inject .item').destroy();
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
                                localStorage['rh-pinned'] = JSON.encode(pi);
                            }
                            $$('#pi-inject .item').destroy();
                            pinned();
                            if ($$('#pi-inject .item').length == 0) {
                                $('pi-inject').setStyle('display', 'none');
                            }
                            $$('#popup-insert .item').setStyle('background-color', 'transparent');
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
    $('alert-no').addEvent('click', function () {
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

    var tip = '';
    if (title == url) {
        tip = title;
    } else {
        tip = title + ' | ' + url;
    }
    if (time !== undefined) {
        tip = tip + ' | ' + time;
    }

    if (type !== 'pi') {
        var ui = '<span class="ui-pin" data-function="' + type + '">&nbsp;</span><span class="ui-delete" data-function="' + type + '">&nbsp;</span>';
    } else {
        var ui = '<span class="ui-delete" data-function="' + type + '">&nbsp;</span>';
    }

    item += '<img class="favicon" alt="Favicon" src="' + favicon + '">';
    item += '<span class="title" title="' + tip + '"><span class="edit-items-ui" data-url="' + url + '" data-title="' + tip.replace(/\'/g, "\\'") + '">' + ui + '</span>' + title + '</span>';
    item += '<span ' + saext + ' class="extra-url"><span ' + sext + ' class="extra">' + returnLang("visits") + ': ' + visits + extsep + '</span><span ' + surl + ' class="url">' + url.replace(/^(.*?)\:\/\//, '').replace(/\/$/, '') + '</span></span>';

 

    var click =  function () {
        leftClick(url);
    };
  

    // switch tab
    if (data.tabId != undefined) {
        click = function () {
            openTab(data.tabId);
        }
    } else if (data.sessionId != undefined) {
        click = function () {
            chrome.sessions.restore(data.sessionId , function (session) { })
        }
    }


    return new Element('a', {
        'events': {
            'click': click,
            'contextmenu': function () {
                rightClick(url);
            }
        },
        'class': 'item',
        target: '_blank',
        styles: sobj,
        // href: url,
        html: item
    });

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
                        var furl = 'chrome://favicon/' + hi[i].url;
                        var test = (/^(file|chrome|chrome-extension|chrome-devtools)\:\/\//).test(url);

                        if (title == '') {
                            title = url;
                        }

                        if (filtUrl(url) == false) {
                            formatItem({ type: 'rh', title: title, url: url, favicon: furl, visits: visits, time: timeNow(hi[i].lastVisitTime) }).inject('rh-inject', 'bottom');
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
                var furl = tab.favIconUrl;

                if (title == '') {
                    title = url;
                }
                formatItem({ type: 'rct', sessionId: sessionId, title: title, url: url, favicon: furl }).inject('rct-inject', 'bottom');

            }


            if ($$('#rct-inject .item').length == 0) {
                $('rct-inject').setStyle('display', 'none');
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

    var rhhistory = chrome.extension.getBackgroundPage().openedTabs;
    var rt = chrome.extension.getBackgroundPage().recentTabs;
    console.log("showRecentTabs() count = "+rt.length);

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
                var furl = 'chrome://favicon/' + rhhistory[t].url;

                if (title == '') {
                    title = url;
                }

                if (title !== undefined) {
                    formatItem({ type: 'rt', title: title, url: url, favicon: furl, time: time , tabId: t }).inject('rt-inject', 'bottom');
                    rcti++;
                }

            } else {
                console.log("showRecentTabs() tabId = " + t + ", rhhistory undefined");
            }

        }

        if ($$('#rt-inject .item').length == 0) {
            $('rt-inject').setStyle('display', 'none');
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
                    formatItem({ type: 'mv', url: mvd[i].url, favicon: mvd[i].favicon, title: mvd[i].title, visits: mvd[i].visitCount }).inject('mv-inject', 'bottom');
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
                        var furl = 'chrome://favicon/' + bm[i].url;

                        if (title == '') {
                            title = url;
                        }

                        formatItem({ type: 'rb', url: url, title: title, favicon: furl, time: formatDate(bm[i].dateAdded) }).inject('rb-inject', 'bottom');

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
                formatItem({ type: 'pi', url: pd[i].url, favicon: pd[i].favicon, title: pd[i].title, time: pd[i].time }).inject('pi-inject', 'bottom');
            }

        }

    }

}


// Alert user history

function alertUserHistory(pm) {
    if ($('alert-holder').getStyle('display') == 'block') {
        $('alert-holder').setStyle('display', 'none');
        $('alert-holder-loading').setStyle('margin-top', '-15px');
    } else if ($('alert-holder').getStyle('display') == 'none') {
        $('alert-holder').setStyle('display', 'block');
    }
}

function alertLoadingHistory(pm) {
    if (pm) {
        $('alert-holder').setStyle('display', 'none');
        $('alert-holder-loading').setStyle('margin-top', '-15px');
    } else if ($('alert-holder').getStyle('display') == 'none') {
        $('alert-holder').setStyle('display', 'block');
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

    var site = new URI(url).get('host');
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
    if ($$('#calendar')[0].getStyle('display') == 'none') {
        $$('#calendar').setStyle('display', 'inline');
    } else {
        $$('#calendar').setStyle('display', 'none');
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
        var mcheck = dayarray[($('date-select-month').getSelected().get('value') * 1 - 1)];
        var dcheck = ($('date-select-day').getSelected().get('value') * 1);
        if (mcheck < dcheck) {
            var cdateo = new Date(($('date-select-year').getSelected().get('value') * 1), ($('date-select-month').getSelected().get('value') * 1 - 1), mcheck, 23, 59, 59, 999);
        } else {
            var cdateo = new Date(($('date-select-year').getSelected().get('value') * 1), ($('date-select-month').getSelected().get('value') * 1 - 1), ($('date-select-day').getSelected().get('value') * 1), 23, 59, 59, 999);
        }
    }

    if (e == 'prev') {
        cdateo.setDate(cdateo.getDate() - 1);
    } else if (e == 'next') {
        cdateo.setDate(cdateo.getDate() + 1);
    }

    $('date-select-day').set('html', '');
    var ydatec = new Date().getFullYear();
    var mdatec = cdateo.getMonth();
    var ddatec = cdateo.getDate();
    var yeararray = [ydatec, (ydatec - 1)];

    if (w == 'current') {
        for (i = 0; i < yeararray.length; i++) {
            if (i == 0) {
                new Element('option', { 'value': yeararray[i], 'selected': 'selected', 'text': yeararray[i] }).inject('date-select-year');
            } else {
                new Element('option', { 'value': yeararray[i], 'text': yeararray[i] }).inject('date-select-year');
            }
        }
    }

    $$('#date-select-month option').each(function (el) {
        if ((mdatec) + 1 == (el.get('value') * 1)) {
            el.set('selected', 'selected');
        }
    });

    for (i = 0; i <= dayarray.length; i++) {
        if (mdatec == i) {
            for (ia = 1; ia <= dayarray[i]; ia++) {
                if (ia == ddatec) {
                    ia = ia + '';
                    if (ia.length == 1) {
                        ia = '0' + ia;
                    }
                    new Element('option', { 'value': ia, 'selected': 'selected', 'text': ia }).inject('date-select-day');
                } else {
                    ia = ia + '';
                    if (ia.length == 1) {
                        ia = '0' + ia;
                    }
                    new Element('option', { 'value': ia, 'text': ia }).inject('date-select-day');
                }
            }
        }
    }

    var fday = new Date(ydatec, mdatec, 1, 23, 59, 59, 999).getDay();
    var lday = new Date(ydatec, mdatec, dayarray[mdatec], 23, 59, 59, 999).getDay();

    $('calendar-days').set('text', '');

    for (ii = 0; ii < dayarray[mdatec]; ii++) {
        if (ii == 0) {
            for (d = 0; d < fday; d++) {
                new Element('span', { html: '&nbsp;', 'class': 'day' }).inject('calendar-days');
            }
        }
        if ((ii + 1) == ddatec) {
            new Element('a', {
                id: 'selected',
                href: '#',
                rel: (ii + 1) + '|' + (mdatec + 1) + '|' + ydatec,
                text: (ii + 1),
                'class': 'day',
                events: {
                    click: function () {
                        var cel = this;
                        $$('#date-select-day option').each(function (el) {
                            if (el.get('value').toInt() == cel.get('text').toInt()) {
                                el.set('selected', 'selected');
                            } else {
                                el.set('selected', '');
                            }
                        });
                        $$('#calendar-days a#selected').removeProperty('id');
                        cel.set('id', 'selected');
                        history('yes', '');
                    }
                }
            }).inject('calendar-days');
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


            new Element('a', {
                href: '#',
                text: (ii + 1),
                'class': 'day',
                'style': style,
                events: {
                    click: function () {
                        var cel = this;
                        $$('#date-select-day option').each(function (el) {
                            if (el.get('value').toInt() == cel.get('text').toInt()) {
                                el.set('selected', 'selected');
                            } else {
                                el.set('selected', '');
                            }
                        });
                        $$('#calendar-days a#selected').removeProperty('id');
                        cel.set('id', 'selected');
                        history('yes', '');
                    }
                }
            }).inject('calendar-days');
        }
        if ((ii + 1) == dayarray[mdatec]) {
            for (d = 0; d < (6 - lday); d++) {
                new Element('span', { html: '&nbsp;', 'class': 'day' }).inject('calendar-days');
            }
        }
    }

}




// History

function history(w, q) {

    var sw = $('rh-what').getSelected().get('value');
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
            var day = ($('date-select-day').getSelected().get('value') * 1);
            var month = ($('date-select-month').getSelected().get('value') * 1 - 1);
            var year = ($('date-select-year').getSelected().get('value') * 1);
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
        $('rh-views-search-insert').setStyle('display', 'none');
        $('rh-views-insert').setStyle('display', 'block');
        $('rh-search').set('value', '');
        $('delete-range-one').set('value', formatDate(eTime));
        $('delete-range-two').set('value', formatDate(eTime));
    } else if (w == 'search') {
        if (sw == 'current') {
            var day = ($('date-select-day').getSelected().get('value') * 1);
            var month = ($('date-select-month').getSelected().get('value') * 1 - 1);
            var year = ($('date-select-year').getSelected().get('value') * 1);
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
        $('rh-views-search-insert').setStyle('display', 'block');
        $('rh-views-insert').setStyle('display', 'none');
    }

    $(into).set('text', returnLang('loading'));

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
                        var furl = 'chrome://favicon/' + hi[i].url;

                        if (title == '') {
                            title = url;
                        }

                        if (hi[i].lastVisitTime >= obj['startTime'] && hi[i].lastVisitTime <= obj['endTime']) {
                            //   rha.push({epoch: hi[i].lastVisitTime, url: url, host: (new URI(url).get('host')), time: timeNow(hi[i].lastVisitTime), date: formatDate(hi[i].lastVisitTime), favicon: furl, title: truncate(title_fix(title), 0, 100), visits: visits});
                            rha.push({ epoch: hi[i].lastVisitTime, url: url, host: (new URI(url).get('host')), time: TimeToStr(hi[i].lastVisitTime, true, true, false), date: formatDate(hi[i].lastVisitTime), favicon: furl, title: truncate(title_fix(title), 0, 100), visits: visits });

                        }

                    }

                }

            }

            if (rha.length > 0) {

                $('master-check-all').set('disabled', 'disabled');

                if (into == 'rh-views-insert') {
                    var rhat = rha.length;
                    $('calendar-total-value').set('text', rhat);
                    if (rhat == 0 || rhat < 50) {
                        $$('#calendar a#selected').setStyle('background-color', '#daf3cb');
                    } else if (rhat > 49 && rhat < 100) {
                        $$('#calendar a#selected').setStyle('background-color', '#aade8a');
                    } else if (rhat > 99 && rhat < 150) {
                        $$('#calendar a#selected').setStyle('background-color', '#6dc738');
                        $$('#calendar a#selected').setStyle('color', '#fff');
                    } else {
                        $$('#calendar a#selected').setStyle('background-color', '#4e991f');
                        $$('#calendar a#selected').setStyle('color', '#fff');
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

                $(into).set('text', '');

                var ibcv = 'grey';
                var Counter = { counter: 0 };

                if (grp == 'yes') {  // 注意此处回调耗时操作
                    prh = (function () {
                        var thisc = this;
                        if (thisc.counter == rha.length) {
                            clearInterval(prh);
                            //isBookmarked('#rh-views .item .link');
                            alertLoadingHistory(true);
                            $(document.body).getElement('#rh-bar-uione input').set('checked', false);
                            selectedItem = undefined;
                            new Tips('.title', { className: 'tip-holder' });
                            if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].get('title')); }
                            $('master-check-all').removeProperty('disabled');
                        } else {
                            if (rha[thisc.counter] !== undefined) {
                                if (!$(into).getElement('div[rel="' + rha[thisc.counter].host + '"]')) {
                                    var toggleid = 'toggle-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var moreid = 'more-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    var groupid = 'group-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                    new Element('div', {
                                        title: rha[thisc.counter].host,
                                        rel: ibcv,
                                        'class': 'item-holder group-title ',
                                        html: '<a href="#" class="group-title-toggle" id="' + toggleid + '" data-host="' + rha[thisc.counter].host + '" rel="' + rha[thisc.counter].host + '"></a><input type="checkbox" class="group-title-checkbox" id="' + moreid + '" value="' + rha[thisc.counter].host + '"><img id="' + errorid + '" class="group-title-favicon" alt="Favicon" src="' + rha[thisc.counter].favicon + '"><span id="' + groupid + '" data-host="' + rha[thisc.counter].host + '" class="group-title-host">' + rha[thisc.counter].host.replace('www.', '') + '</span>'
                                    }).inject(into);
                                    $(toggleid).addEvent('click', function () {
                                        var host = this.getProperty('data-host');
                                        toggleGroup(host);
                                    });
                                    $(moreid).addEvent('click', function () {
                                        getMoreItems(this);
                                    });
                                    $(errorid).addEvent('error', function () {
                                        this.setProperty('src', 'images/blank.png');
                                    });
                                    $(groupid).addEvent('click', function () {
                                        var host = this.getProperty('data-host');
                                        toggleGroup(host);
                                    })
                                    new Element('div', { 'class': 'group-holder', rel: rha[thisc.counter].host, styles: { 'display': 'none' } }).inject(into);
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
                                new Element('div', {
                                    'rel': $(into).getElement('div.item-holder[title="' + rha[thisc.counter].host + '"]').get('rel'),
                                    'class': 'item-holder',
                                    styles: {
                                        'background-color': $(into).getElement('div.item-holder[title="' + rha[thisc.counter].host + '"]').getStyle('background-color')
                                    }
                                }).set('html', item + '<div class="clearitem" style="clear:both;"></div>').inject($(into).getElement('div[rel="' + rha[thisc.counter].host + '"]'));
                                $(selectid).addEvent('click', function () {
                                    selectHistoryItem(this, 'single');
                                });
                            }
                        }
                        thisc.counter++;
                    }).periodical(5, Counter);
                } else if (grp == 'no') {
                    prh = (function () {
                        var thisc = this;
                        if (thisc.counter == rha.length) {
                            clearInterval(prh);
                            //isBookmarked('#rh-views .item .link');
                            alertLoadingHistory(true);
                            $(document.body).getElement('#rh-bar-uione input').set('checked', false);
                            selectedItem = undefined;
                            new Tips('.title', { className: 'tip-holder' });
                            if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].get('title')); }
                            $('master-check-all').removeProperty('disabled');
                        } else {
                            if (rha[thisc.counter] !== undefined) {
                                if (w == 'search' && (sw == 'all' || sw == 'recent')) {
                                    // rha[thisc.counter].time = '- - : - -';
                                }
                                var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var item;
                                item = '<div class="item">';
                                item += '<span class="checkbox"><label><input class="chkbx" type="checkbox" id="' + selectid + '" value="' + rha[thisc.counter].url + '" name="check"></label>&nbsp;</span>';
                                //item += '<span class="bookmark">&nbsp;</span>';
                                item += '<span class="time">' + rha[thisc.counter].time + '</span>';
                                item += '<a target="_blank" class="link" href="' + rha[thisc.counter].url + '">';
                                item += '<img id="' + errorid + '" class="favicon" alt="Favicon" src="' + rha[thisc.counter].favicon + '">';
                                item += '<span class="title" title="' + rha[thisc.counter].url + '" rel="' + returnLang('visits') + ': ' + rha[thisc.counter].visits + ' | ' + rha[thisc.counter].time + ' ' + rha[thisc.counter].date + '">' + rha[thisc.counter].title + '</span>';
                                item += '</a>';
                                item += '</div>';
                                new Element('div', { 'rel': ibcv, 'class': 'item-holder ' }).set('html', item + '<div class="clearitem" style="clear:both;"></div>').inject(into);

                                if (ibcv == 'white') {
                                    ibcv = 'grey';
                                } else {
                                    ibcv = 'white';
                                }
                                $(selectid).addEvent('click', function () {
                                    selectHistoryItem(this, 'single');
                                });
                                $(errorid).addEvent('error', function () {
                                    this.setProperty('src', 'images/blank.png');
                                });
                            }
                        }
                        thisc.counter++;
                    }).periodical(5, Counter);
                }
                alertLoadingHistory(true);
            } else {
                alertLoadingHistory(true);
                $('calendar-total-value').set('text', '0');
                $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
            }

            //            alertLoadingHistory(true);
        } else {
            $('calendar-total-value').set('text', '0');
            $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
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
    var tgda = $(into).getElement('a[rel="' + host + '"]');
    var tgde = $(into).getElement('div[rel="' + host + '"]');

    if (tgda != undefined && tgde != undefined) {
        var tgdv = tgde.getStyle('display');
        if (tgdv == 'block') {
            tgde.setStyle('display', 'none');
            tgda.setStyle('background-position', 'left center');
        } else {
            tgde.setStyle('display', 'block');
            tgda.setStyle('background-position', 'right center');
        }
    } else {
        console.log('error: toggleGroup(' + host + ')');
    }

}


// Get active history

function getActiveHistory() {
    if ($('rh-views-insert').getStyle('display') == 'block') {
        return 'history';
    } else if ($('rh-views-search-insert').getStyle('display') == 'block') {
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
    var ihost = el.get('value');
    if (el.get('checked') == false) {
        $$(into + ' .chkbx').each(function (ele) {
            var eleh = new URI(ele.get('value')).get('host');
            if (ihost == eleh) {
                ele.set('checked', false);
                if (ele.getParent('div.item-holder').get('rel') == 'white') {
                    ele.getParent('div.item-holder').setStyle('background-color', '#fff');
                    el.getParent('div.group-title').setStyle('background-color', '#fff');
                } else {
                    ele.getParent('div.item-holder').setStyle('background-color', '#f1f1f1');
                    el.getParent('div.group-title').setStyle('background-color', '#f1f1f1');
                }
            }
        });
    } else if (el.get('checked') == true) {
        $$(into + ' .chkbx').each(function (ele) {
            var eleh = new URI(ele.get('value')).get('host');
            if (ihost == eleh) {
                ele.set('checked', true);
                el.getParent('div.group-title').setStyle('background-color', itemSelectedColor);
                selectHistoryItem(ele, 'single');
            }
        });
    }
    if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
        $('master-check-all').set('checked', true);
        $('master-check-all').set('value', 'true');
    } else {
        $('master-check-all').set('checked', false);
        $('master-check-all').set('value', 'false');
    }
}


// Reset color

function resetColor() {
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        var into = '#rh-views-search-insert';
    }
    $$(into + ' .item-holder').each(function (el) {
        if (el.get('rel') == 'grey') {
            el.setStyle('background-color', '#f1f1f1');
        } else if (el.get('rel') == 'white') {
            el.setStyle('background-color', '#fff');
        }
        if (el.getElement('input.chkbx').get('checked') == true) {
            el.setStyle('background-color', itemSelectedColor);
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
        if (el.get('checked') == true) {
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
                        if (chkbxs[i].get('checked') == true) {
                            chkbxs[i].set('checked', false);
                            if (chkbxs[i].getParent('div.item-holder').get('rel') == 'white') {
                                chkbxs[i].getParent('div.item-holder').setStyle('background-color', '#fff');
                            } else {
                                chkbxs[i].getParent('div.item-holder').setStyle('background-color', '#f1f1f1');
                            }
                        } else if (chkbxs[i].get('checked') == false) {
                            chkbxs[i].set('checked', true);
                            chkbxs[i].getParent('div.item-holder').setStyle('background-color', itemSelectedColor);
                        }
                    }
                }
            }
            selectedItem = el;
            el.getParent('div.item-holder').setStyle('background-color', itemSelectedColor);
        } else if (el.get('checked') == false) {
            selectedItem = undefined;
            var iurl = el.get('value');
            $$(into + ' .chkbx').each(function (ele) {
                if (ele.get('value') == iurl) {
                    if (ele.getParent('div.item-holder').get('rel') == 'white') {
                        ele.getParent('div.item-holder').setStyle('background-color', '#fff');
                    } else {
                        ele.getParent('div.item-holder').setStyle('background-color', '#f1f1f1');
                    }
                }
            });
        }
        if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
            $('master-check-all').set('checked', true);
            $('master-check-all').set('value', 'true');
        } else {
            $('master-check-all').set('checked', false);
            $('master-check-all').set('value', 'false');
        }
        if (grp == 'yes') {
            var elem = el.getParent('.group-holder');
            if (elem.getElements('.chkbx').length == elem.getElements('.chkbx:checked').length) {
                $$(into + ' div[title="' + elem.get('rel') + '"]')[0].setStyle('background-color', itemSelectedColor);
                $$(into + ' div[title="' + elem.get('rel') + '"]')[0].getElement('.group-title-checkbox').set('checked', true);
            } else {
                if ($$(into + ' div[title="' + elem.get('rel') + '"]')[0].get('rel') == 'grey') {
                    $$(into + ' div[title="' + elem.get('rel') + '"]')[0].setStyle('background-color', '#f1f1f1');
                    $$(into + ' div[title="' + elem.get('rel') + '"]')[0].getElement('.group-title-checkbox').set('checked', false);
                } else if ($$(into + ' div[title="' + elem.get('rel') + '"]')[0].get('rel') == 'white') {
                    $$(into + ' div[title="' + elem.get('rel') + '"]')[0].setStyle('background-color', '#fff');
                    $$(into + ' div[title="' + elem.get('rel') + '"]')[0].getElement('.group-title-checkbox').set('checked', false);
                }
            }
        }
    } else if (w == 'all') {
        if (el.get('value') == 'false') {
            $$(into + ' .chkbx').each(function (ele) {
                ele.set('checked', true);
                ele.getParent('div.item-holder').setStyle('background-color', itemSelectedColor);
            });
            if (grp == 'yes') {
                $$(into + ' .group-title').each(function (gel) {
                    gel.getElement('input').set('checked', true);
                    gel.setStyle('background-color', itemSelectedColor);
                });
            }
            el.set('value', 'true');
        } else {
            $$(into + ' .chkbx').each(function (ele) {
                ele.set('checked', false);
                if (ele.getParent('div.item-holder').get('rel') == 'white') {
                    ele.getParent('div.item-holder').setStyle('background-color', '#fff');
                } else {
                    ele.getParent('div.item-holder').setStyle('background-color', '#fafafa');
                }
            });
            if (grp == 'yes') {
                $$(into + ' .group-title').each(function (gel) {
                    gel.getElement('input').set('checked', false);
                    if (gel.get('rel') == 'white') {
                        gel.setStyle('background-color', '#fff');
                    } else {
                        gel.setStyle('background-color', '#fafafa');
                    }
                });
            }
            el.set('value', 'false');
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
            $$('title').set('text', 'Deleting...');
            alertLoadingHistory(true);
            $$(into + ' .checkbox input:checked').each(function (el) {
                el.getParent('div.item-holder').destroy();
                chrome.history.deleteUrl({ url: el.get('value') });
            });
            chrome.history.search({ text: '', maxResults: 1, startTime: (new Date()).getTime() - (1 * 24 * 3600 * 1000), endTime: (new Date()).getTime() }, function (hi) {
                if (grp == 'yes') {
                    $$(into + ' .group-holder').each(function (gel) {
                        if (gel.getChildren('div.item-holder').length == 0) {
                            $$(into + ' .group-title[title="' + gel.get('rel') + '"]').destroy();
                            gel.destroy();
                        }
                    });
                }
                $$('title').set('text', 'History | Recent History');
                alertLoadingHistory(true);
            });
        }
    } else if (w == 'range') {
        var dober = {};
        var dobsr = {};
        var df = localStorage['rh-date'];
        var dfs = df.split('/');
        var sr = $('delete-range-one').get('value').split('/');
        var er = $('delete-range-two').get('value').split('/');
        for (d = 0; d < dfs.length; d++) {
            dobsr[dfs[d]] = sr[d];
            dober[dfs[d]] = er[d];
        }
        var startRange = new Date(dobsr['yyyy'], (dobsr['mm'] - 1), dobsr['dd'], 23, 59, 59, 999).getTime() - 86400000;
        var endRange = new Date(dober['yyyy'], (dober['mm'] - 1), dober['dd'], 23, 59, 59, 999).getTime();
        if (startRange < endRange) {
            $$('title').set('text', 'Deleting...');
            alertUserHistory(true);
            chrome.history.deleteRange({ startTime: startRange, endTime: endRange }, function () {
                calendar('yes', '');
                history('yes', '');
                $$('title').set('text', 'History | Recent History');
                alertUserHistory(true);
            });
        }
    }
}

function get_host(url) {
    let host = new URI(url).get('host');
    if (host == undefined || host == "")
        return "#";
    else
        return host;
}

// DOM functions

document.addEvent('domready', function () {

    // Display language strings

    $$('.lang').each(function (el) {
        el.innerHTML = returnLang(el.getProperty('data-lang-string'));
    });

    // Href hashes

    (function () {
        $$('a[href="#"]').each(function (el) {
            if (el.hasClass('hrefhash')) {
                // Do nothing
            } else {
                el.addEvent('click', function (el) {
                    return false;
                });
                el.addClass('hrefhash');
            }
        });
    }).periodical(250);

});
