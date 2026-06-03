// Tree Style History - History Core Module
// History page display functions extracted from func.js

import { $, $$, createElement } from '../dom-helper.js';
import { returnLang, TimeToStr, formatDate, truncate, title_fix, get_host, getFaviconUrl, escapeHtmlAttr, _DATE } from './helpers.js';
import { filtUrl } from './config.js';
import { calendar_storage2, save_calendar_storage2 } from './calendar.js';

// Module-level variables
var selectedItem;
var prh;

// --- Alert functions ---

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

// --- History search and display ---

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

            for (var i = 0; i <= hi.length; i++) {

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

                if (grp == 'yes') {
                    prh = setInterval(function () {
                        var thisc = Counter;
                        if (thisc.counter == rha.length) {
                            clearInterval(prh);
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
                                    // rha[thisc.counter].time = '- - : - -';
                                }
                                var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var item;
                                item = '<div class="item">';
                                item += '<span class="checkbox"><label><input class="chkbx" type="checkbox" id="' + selectid + '" value="' + rha[thisc.counter].url + '" name="check"></label>&nbsp;</span>';
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

        } else {
            $('calendar-total-value').textContent = '0';
            $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
        }

    });

}

// --- Group toggle ---

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

// --- Get active history view type ---

function getActiveHistory() {
    if ($('rh-views-insert').style.display == 'block') {
        return 'history';
    } else if ($('rh-views-search-insert').style.display == 'block') {
        return 'search';
    }
}

// --- Bulk select/cancel ---

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
                el.closest('div.group-title').style.backgroundColor = window.itemSelectedColor;
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

// --- Reset color ---

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
            el.style.backgroundColor = window.itemSelectedColor;
        }
    });
}

// --- Select history item ---

function selectHistoryItem(el, w) {
    var grp = localStorage['rh-group'];
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        var into = '#rh-views-search-insert';
    }
    if (w == 'single') {
        if (el.checked == true) {
            if (window.shiftState == 'true' && selectedItem !== undefined) {
                var hitState = 'false';
                var chkbxs = $$(into + ' .chkbx');
                for (var i = 0; i < chkbxs.length; i++) {
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
                            chkbxs[i].closest('div.item-holder').style.backgroundColor = window.itemSelectedColor;
                        }
                    }
                }
            }
            selectedItem = el;
            el.closest('div.item-holder').style.backgroundColor = window.itemSelectedColor;
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
                        titleDivs[0].style.backgroundColor = window.itemSelectedColor;
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
                ele.closest('div.item-holder').style.backgroundColor = window.itemSelectedColor;
            });
            if (grp == 'yes') {
                Array.from($$(into + ' .group-title')).forEach(function (gel) {
                    var chkInput = gel.querySelector('input');
                    if (chkInput) chkInput.checked = true;
                    gel.style.backgroundColor = window.itemSelectedColor;
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

// --- Delete history item ---

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
        for (var d = 0; d < dfs.length; d++) {
            dobsr[dfs[d]] = sr[d];
            dober[dfs[d]] = er[d];
        }
        var startRange = new Date(dobsr['yyyy'], (dobsr['mm'] - 1), dobsr['dd'], 23, 59, 59, 999).getTime() - 86400000;
        var endRange = new Date(dober['yyyy'], (dober['mm'] - 1), dober['dd'], 23, 59, 59, 999).getTime();
        if (startRange < endRange) {
            document.title = 'Deleting...';
            alertUserHistory(true);
            chrome.history.deleteRange({ startTime: startRange, endTime: endRange }, function () {
                window.calendar('yes', '');
                history('yes', '');
                document.title = 'History | Recent History';
                alertUserHistory(true);
            });
        }
    }
}

export {
    history,
    toggleGroup,
    getActiveHistory,
    getMoreItems,
    resetColor,
    selectHistoryItem,
    deleteHistoryItem,
    alertUserHistory,
    alertLoadingHistory
};