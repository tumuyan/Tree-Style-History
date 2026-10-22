// Tree Style History - linear bookmarks page
//
// An ES module: every function it calls is imported, not read off `window`.

import { $, $$, createElement, getStyle } from './dom-helper.js';
import {
    TimeToStr, formatDate, truncate, returnLang, get_host,
    getFaviconUrl, getFaviconOnerror, setupFaviconElement,
    escapeHtmlAttr, escapeHtmlText, executeBookmarklet, isBookmarkletUrl
} from './modules/helpers.js';
import { filtUrl } from './modules/config.js';
import { getActiveHistory, toggleGroup, getMoreItems, alertLoadingHistory, clearRowColor, groupTitleOf } from './modules/history-core.js';
import { modifierState, ITEM_SELECTED_COLOR, RENDER_BUDGET_MS } from './modules/ui-state.js';
import { initPage } from './modules/page-init.js';

initPage();

// --- Selection: a module-level function, not a closure inside the page
// bootstrap. Everything it needs is the DOM and the imported helpers, so
// keeping it here is what lets the behaviour tests import it instead of
// reaching for it through a global the page would otherwise have to mount.

function getActiveBookmark() {
    if (getStyle($('rh-views-insert'), 'display') == 'block') {
        return 'history';
    } else if (getStyle($('rh-views-search-insert'), 'display') == 'block') {
        return 'search';
    }
}


/**
 * Paint one bookmark row as selected (or not).
 *
 * The inline ITEM_SELECTED_COLOR belongs to whichever element the theme's
 * `div[rel=...]` rules are *not* providing the colour for: the group title
 * when the row is grouped, the row itself otherwise. Painting the row in
 * both cases is what left a single pink bookmark inside a white group while
 * the title stayed unselected.
 *
 * Selecting paints; unselecting only ever removes this row's own colour.
 * The title is not this row's to clear — one still-ticked sibling and the
 * selection it stands for disappear with it — so that is decided by
 * `clearOrphanedTitles()` once the whole sweep has run.
 *
 * Clearing goes through `clearRowColor()` rather than a literal so the row
 * falls back to the stylesheet, which differs per theme.
 */
function markBookmarkedRow(checkbox, selected) {
    var row = checkbox.closest('div.item-holder');
    // Unselecting never touches a title, so it does not resolve one. Calling
    // `groupTitleOf()` here anyway is what made "unselect all" quadratic: it
    // walks the container's `children`, so once per row it costs rows x groups.
    // Measured on this page's own render shape: 8000 bookmarks over 2000 groups
    // went 58ms -> 4188ms, 4000 over 1000 went 41ms -> 708ms.
    if (!selected) {
        clearRowColor(row);
        return;
    }
    var title = groupTitleOf(checkbox);
    if (title) {
        title.style.backgroundColor = ITEM_SELECTED_COLOR;
    } else if (row) {
        row.style.backgroundColor = ITEM_SELECTED_COLOR;
    }
}

/**
 * Release the group titles whose last ticked row has just been unticked.
 *
 * A title belongs to the group, so it is cleared only when nothing in that
 * group is ticked any more — clearing it per row is what left a sibling
 * ticked with no mark of it, and the delete button live for a row that
 * looked unselected. Decided after the sweep has set every checkbox, so the
 * state the titles are read against is the final one.
 */
function clearOrphanedTitles(groups) {
    for (var host in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, host)) continue;
        var group = groups[host];
        if (group.survivors === 0) clearRowColor(group.title);
    }
}

function selectBookmarkItem(el, w) {
    if (getActiveBookmark() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveBookmark() == 'search') {
        into = '#rh-views-search-insert';
    }

    if (w == 'single') {
        if (el.checked == true) {
            // Not a bare `row.style.backgroundColor = ITEM_SELECTED_COLOR`:
            // a grouped row carries no inline colour of its own (it shows
            // the group title's), so painting the row directly turned one
            // bookmark pink inside a group of white ones.
            markBookmarkedRow(el, true);
        } else if (el.checked == false) {
            var iurl = el.value;
            var items = $$(into + ' .chkbx');
            // host -> { title, holder, survivors }: a group keeps its colour
            // while any row of it is still ticked.
            //
            // Only the groups this sweep actually touched are in here. A click
            // unticks the rows of ONE url, so every other group is exactly as
            // it was and counting it buys nothing — while costing the whole
            // view, since bookmark.html spreads its rows over one group per
            // host. That made a single click walk every bookmark the user has.
            var groups = {};
            for (var i = 0; i < items.length; i++) {
                (function(ele) {
                    if (ele.value != iurl) return;
                    // The row can be gone: a delete detaches
                    // `div.item-holder` elements while this sweep is
                    // still walking their checkboxes.
                    markBookmarkedRow(ele, false);
                    // The holder is where the tally is asked, and it is the
                    // same element `groupTitleOf()` resolves the title from —
                    // taken here so the two halves cannot name different
                    // groups. Null only for an ungrouped row, which has no
                    // title to keep either.
                    var holder = ele.closest('div.group-holder');
                    if (!holder) return;
                    var title = groupTitleOf(ele);
                    if (!title) return;
                    var host = title.getAttribute('title');
                    if (!groups[host]) {
                        groups[host] = { title: title, holder: holder, survivors: 0 };
                    }
                })(items[i]);
            }
            // Read after the sweep has set every checkbox, because which row is
            // the group's last one is only true at the end — and scoped to the
            // group's own holder, so "is anything in this group still ticked"
            // is one query per group, not one per row in the view.
            for (var host in groups) {
                if (!Object.prototype.hasOwnProperty.call(groups, host)) continue;
                var group = groups[host];
                group.survivors = group.holder.querySelectorAll('.chkbx:checked').length;
            }
            clearOrphanedTitles(groups);
        }
        if ($$(into + ' .chkbx').length == $$(into + ' .chkbx:checked').length) {
            $('master-check-all').checked = true;
            $('master-check-all').value = 'true';
        } else {
            $('master-check-all').checked = false;
            $('master-check-all').value = 'false';
        }
    } else if (w == 'all') {
        // Both sweeps walk their own snapshot of the checkboxes and go
        // through the same per-row helper as the single click: the colour a
        // row shows is the group title's when it has one, and its own
        // otherwise — and the detach check has to be the same wherever the
        // walk starts.
        items = $$(into + ' .chkbx');
        var selectingAll = el.value == 'false';
        // Select-all ticks every row, so every group ends up with one and the
        // titles can be painted in a single pass below. Resolving one per row
        // instead — the shape this branch had — cost rows x groups: 7.5s for
        // 8000 bookmarks over 2000 groups, against ~40ms now. It is the same
        // trap the single-click path climbed out of one branch earlier.
        for (i = 0; i < items.length; i++) {
            (function(ele) {
                ele.checked = selectingAll;
                // `closest()` walks the row's own ancestors, so it is one
                // cheap question per row — and it asks the DOM rather than the
                // setting, so a row in a collapsed group is still a grouped
                // row. Unselecting still goes through the helper either way:
                // it only clears the row's own colour.
                if (selectingAll && ele.closest('div.group-holder')) return;
                markBookmarkedRow(ele, selectingAll);
            })(items[i]);
        }
        if (selectingAll) {
            // One walk of the container, after the sweep: every row is ticked,
            // so every group has one and each title is painted exactly once.
            Array.from($$(into + ' .group-title')).forEach(function (gel) {
                gel.style.backgroundColor = ITEM_SELECTED_COLOR;
            });
        } else {
            // Unselect-all empties every group, so no group can have a ticked
            // row left and there is nothing to count. Collecting survivors here
            // used to answer 0 for all of them (the loop above has just set
            // every checkbox false) — a whole tally whose result was decided
            // before it ran. Same shape as history-core.js's unselect-all.
            Array.from($$(into + ' .group-title')).forEach(function (gel) {
                clearRowColor(gel);
            });
        }
        el.value = selectingAll ? 'true' : 'false';
    }

    updateBookmarkButtons();
}

function updateBookmarkButtons() {
    var into = getActiveBookmark() == 'history' ? '#rh-views-insert' : '#rh-views-search-insert';
    var checkedItems = $$(into + ' .chkbx:checked');
    var checkedCount = checkedItems.length;

    if (checkedCount > 0) {
        $('delete-bookmark-button').style.display = 'inline-block';
    } else {
        $('delete-bookmark-button').style.display = 'none';
    }

    if (checkedCount == 1) {
        $('edit-bookmark-button').style.display = 'inline-block';
    } else {
        $('edit-bookmark-button').style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    onStorageReady(function () {

        // Fade in using CSS transition

    var historyContainer = $('history-container');
    if (historyContainer) {
        historyContainer.style.transition = 'margin-left 0.25s, margin-right 0.25s, opacity 0.25s';
        if (chrome.i18n.getMessage("@@bidi_dir") == 'rtl' && chrome.i18n.getMessage("@@ui_locale") !== 'en') {
            historyContainer.style.marginRight = '180px';
        } else {
            historyContainer.style.marginLeft = '180px';
        }
        historyContainer.style.opacity = '1';
    }

    // Language
    
    // Set button labels
    if ($('delete-bookmark-button')) {
        $('delete-bookmark-button').value = returnLang('deleteBookmarks');
    }
    if ($('edit-bookmark-button')) {
        $('edit-bookmark-button').value = returnLang('editBookmark');
    }

    // Toggle history

    if (localStorage['rh-group'] == 'no') {
        $('rh-bar-group').style.backgroundPosition = 'right center';
    }
    if (localStorage['rh-orderby'] == 'title') {
        $('rh-bar-orderby').style.backgroundPosition = 'right center';
        $('rh-bar-orderby').title = returnLang('orderByTime'); 
    } else {       
         $('rh-bar-orderby').title = returnLang('orderByTitle');   
    }
    $('rh-bar-order').title = returnLang('order'); 
    if (localStorage['rh-order'] == 'asc') {
        $('rh-bar-order').style.backgroundPosition = 'right center';
    }    
    $('rh-bar-group').title = returnLang('group');   
    $('rh-bar-group').addEventListener('click', function () {
        var rhgv = localStorage['rh-group'];
        if (rhgv == 'yes') {
            $('rh-bar-group').style.backgroundPosition = 'right center';
            localStorage['rh-group'] = 'no';
        } else if (rhgv == 'no') {
            $('rh-bar-group').style.backgroundPosition = 'left center';
            localStorage['rh-group'] = 'yes';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').value;
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });
    $('rh-bar-orderby').addEventListener('click', function () {
        var rhgv = localStorage['rh-orderby'];
        if (rhgv == 'date') {
            $('rh-bar-orderby').style.backgroundPosition = 'right center';
            $('rh-bar-orderby').title = returnLang('orderByTime');  
            localStorage['rh-orderby'] = 'title';
        } else if (rhgv == 'title') {
            $('rh-bar-orderby').style.backgroundPosition = 'left center';
            $('rh-bar-orderby').title = returnLang('orderByTitle');       
            localStorage['rh-orderby'] = 'date';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').value;
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });
    $('rh-bar-order').addEventListener('click', function () {
        var rhgv = localStorage['rh-order'];
        if (rhgv == 'desc') {
            $('rh-bar-order').style.backgroundPosition = 'right center';
            localStorage['rh-order'] = 'asc';
        } else if (rhgv == 'asc') {
            $('rh-bar-order').style.backgroundPosition = 'left center';
            localStorage['rh-order'] = 'desc';
        }
        var gahv = getActiveHistory();
        if (gahv == 'history') {
            bookmark('yes', '');
        } else if (gahv == 'search') {
            var gahviv = $('rh-search').value;
            if (gahviv.length > 0) {
                bookmark('search', gahviv);
            } else {
                bookmark('yes', '');
            }
        }
    });


    // Shift listener

    document.body.addEventListener('keydown', function (e) {
        if (e.keyCode == 16 && !modifierState.shift) {
            modifierState.shift = true;
        }
    });
    document.body.addEventListener('keyup', function (e) {
        if (e.keyCode == 16) {
            modifierState.shift = false;
        }
    });



    //获取Location对象的search属性值
    var searchStr = location.search;

    if (searchStr.length > 1) {
        $("rh-search").value = searchStr;
        bookmark('search', searchStr);
    } else {
        searchStr = '';
    }

    if (searchStr == '')
        bookmark('current', '');


    // Search events


    $('rh-search').addEventListener('keyup', function () {
        var sv = this.value;
        if (sv.length + sv.replace(/[0-9a-zA-Z]+/g, '').length >= 2) {
            if (sv != searchStr) {
                searchStr = sv;
                bookmark('search', sv);
            }
            $('rh-views-insert').style.display = 'none';
            $('rh-views-search-insert').style.display = 'block';

        } else {
            $('rh-views-insert').style.display = 'block';
            $('rh-views-search-insert').style.display = 'none';
        }
    });
    $('rh-search').focus();



    // Assign events

    $('master-check-all').addEventListener('click', function () { selectBookmarkItem(this, 'all'); });
    $('delete-bookmark-button').value = returnLang('deleteBookmarks');
    $('delete-bookmark-button').addEventListener('click', function() { deleteBookmarkItems(); });
    $('edit-bookmark-button').value = returnLang('editBookmark');
    $('edit-bookmark-button').addEventListener('click', function() { editBookmarkItem(); });



    function bmtree2array(path, tree) {

        path = path + '🗁';

        let list = [];
        for (let i = 0; i < tree.length; i++) {
            if (tree[i].children == undefined) {
                let rawTitle = tree[i].title;
                if (rawTitle === undefined || rawTitle === null) {
                    rawTitle = '';
                }
                let displayTitle = rawTitle;
                if (displayTitle === '') {
                    displayTitle = tree[i].url;
                }
                let node = Object.assign({}, tree[i]);
                node.originalTitle = rawTitle;
                if (localStorage['rm-path'] == 'yes') {
                    node.title = (path).replace(/[🗁]+/, '🗁') + ' - ' + displayTitle;
                } else {
                    node.title = displayTitle;
                }
                node.bookmarkId = node.id;
                list.push(node);
            } else {
                // 使用全角字符／，避免解析html发生错误
                list = list.concat(bmtree2array(path + tree[i].title, tree[i].children));
            }
        }
        return list;
    }


    var prh;

    function bookmark(w, q) {

        if (w != 'search')
            w = 'yes';

        if (prh) {
            clearInterval(prh);
        }

        if (w == 'search') {
            var into = 'rh-views-search-insert';
            $('rh-views-search-insert').style.display = 'block';
            $('rh-views-insert').style.display = 'none';
        } else {
            into = 'rh-views-insert';
            $('rh-views-search-insert').style.display = 'none';
            $('rh-views-insert').style.display = 'block';
            $('rh-search').value = '';
        }

        $(into).textContent = returnLang('loading');

        /*  可以进行排序的内容有：
                按照网站分组
                添加顺序
                访问顺序
                访问时间
        */

        if (q == '') {

            chrome.bookmarks.getTree((hi) => {


                if (hi.length > 0) {
                    showData(bmtree2array('', hi), into);
                    //            alertLoadingHistory(true);
                } else {
                    // $('calendar-total-value').set('text', '0');
                    $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
                }
            })

            /* 
                        chrome.bookmarks.getRecent(10000, function (hi) {
                            // console.log(hi);
            
                            if (hi.length > 0) {
                                showData(hi,into);
                                //            alertLoadingHistory(true);
                            } else {
                                // $('calendar-total-value').set('text', '0');
                                $(into).set('html', '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>');
                            }
            
                        }); */

        } else {
            chrome.bookmarks.search(q, (hi) => {
                // console.log(res);

                if (hi.length > 0) {
                    showData(hi, into);
                } else {
                    $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
                }

            })
        }

    }


    function showData(hi, into) {

        alertLoadingHistory(false);
        var rha = [];
        var grp = localStorage['rh-group'];
        var oby = localStorage['rh-orderby'];
        var ord = localStorage['rh-order'];

        for (var i = 0; i < hi.length; i++) {

            if (hi[i] !== undefined) {

                // Skip folders (bookmark tree nodes without a url property)
                if (!hi[i].url) continue;

                if (filtUrl(hi[i].url) == false) {

                    var title = hi[i].title;
                    var originalUrl = hi[i].url;
                    var url = originalUrl;
                    var host = get_host(originalUrl);
                    var visits = hi[i].visitCount;
                    var furl = getFaviconUrl(originalUrl);
                    var bookmarkId = hi[i].bookmarkId || hi[i].id;
                    if (host == "#") {
                        url = encodeURI(originalUrl);
                    }


                    if (title == '') {
                        title = url;
                    }

                    var originalTitle = hi[i].originalTitle;
                    if (originalTitle === undefined || originalTitle === null) {
                        originalTitle = hi[i].title;
                    }
                    if (originalTitle === undefined || originalTitle === null) {
                        originalTitle = '';
                    }

                    // if (hi[i].dateAdded >= obj['startTime'] && hi[i].dateAdded <= obj['endTime'])
                    {
                        // Stored raw: the render loops below escape it for the
                        // text position themselves. Escaping here as well (the
                        // old title_fix() did) turned '"' into '&#34;' and then
                        // into '&amp;#34;' — the entity itself showed up as
                        // text in the bookmark title.
                        var displayTitle = truncate(title, 0, 100);
                        rha.push({ epoch: hi[i].dateAdded, url: url, host: host, time: TimeToStr(hi[i].dateAdded, true, true, true), date: formatDate(hi[i].dateAdded), favicon: furl, title: displayTitle, visits: visits, bookmarkId: bookmarkId, originalTitle: originalTitle });

                    }

                }

            }

        }

        if (rha.length > 0) {

            $('master-check-all').disabled = 'disabled';

            if (oby == 'title') {
                rha.sort(function (a, b) {
                    if (grp == 'yes') {
                        var nameA = a.host.replace('www.', '');
                        var nameB = b.host.replace('www.', '');
                    } else if (grp == 'no') {
                        nameA = a.title;
                        nameB = b.title;
                    }
                    if (nameA < nameB) {
                        return -1;
                    } else if (nameA > nameB) {
                        return 1;
                    } else {
                        var epochA = (a.epoch === undefined || a.epoch === null) ? 0 : Number(a.epoch);
                        var epochB = (b.epoch === undefined || b.epoch === null) ? 0 : Number(b.epoch);
                        return epochB - epochA;
                    }
                });
            } else {
                rha.sort(function (a, b) {
                    var epochA = (a.epoch === undefined || a.epoch === null) ? 0 : Number(a.epoch);
                    var epochB = (b.epoch === undefined || b.epoch === null) ? 0 : Number(b.epoch);

                    if (epochA !== epochB) {
                        return epochA - epochB;
                    }

                    var titleA = (a.title || '').toLowerCase();
                    var titleB = (b.title || '').toLowerCase();
                    if (titleA < titleB) {
                        return -1;
                    } else if (titleA > titleB) {
                        return 1;
                    } else {
                        return 0;
                    }
                });
                rha.reverse();
            }

            if (ord == 'asc') {
                rha.reverse();
            }

            $(into).textContent = '';

            var ibcv = 'grey';
            var Counter = { counter: 0 };
            // host -> { title, holder, label }, filled as groups are created.
            // Every item used to cost five querySelector() calls, each one a
            // full scan of the container. The container was cleared just above,
            // so this starts empty.
            var groups = new Map();

            if (grp == 'yes') {  // 注意此处回调耗时操作
                prh = setInterval((function () {
                    var thisc = this;
                    var deadline = Date.now() + RENDER_BUDGET_MS;
                    while (thisc.counter < rha.length && Date.now() < deadline) {
                        var host = rha[thisc.counter].host;
                        if (host !== undefined) {
                            if (!groups.has(host)) {
                                var toggleid = 'toggle-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var moreid = 'more-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var groupid = 'group-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                                var faviconUrl = rha[thisc.counter].favicon || '';
                                var escapedHost = escapeHtmlAttr(host);
                                // Text position, so the text escaper: it leaves
                                // quotes alone instead of rewriting them to
                                // &quot; in the visible host name.
                                var escapedHostText = escapeHtmlText(host.replace('www.', ''));
                                var groupEl = createElement('div', {
                                    title: host,
                                    rel: ibcv,
                                    'class': 'item-holder group-title ',
                                    html: '<a href="#" class="group-title-toggle group-title-toggle-bookmark" id="' + toggleid + '" data-host="' + escapedHost + '" rel="' + escapedHost + '"></a><label class="group-title-toggle-count" rel="' + escapedHost + '"></label><input type="hidden"  style="width: 0; display:none;   padding: 0 0 0 0;  margin: 0 0 0 0;    visibility: hidden;  left: 0;"  class="group-title-checkbox" id="' + moreid + '" value="' + escapedHost + '"><img id="' + errorid + '" class="group-title-favicon" alt="Favicon"><span id="' + groupid + '" data-host="' + escapedHost + '" class="group-title-host">' + escapedHostText + '</span>'
                                });
                                $(into).appendChild(groupEl);
                                $(toggleid).addEventListener('click', function () {
                                    var host = this.getAttribute('data-host');
                                    toggleGroup(host);
                                });
                                $(moreid).addEventListener('click', function () {
                                    getMoreItems(this);
                                });
                                var _faviconFallbackUrl = getFaviconOnerror(rha[thisc.counter].url);
                                setupFaviconElement($(errorid), faviconUrl, _faviconFallbackUrl);
                                $(groupid).addEventListener('click', function () {
                                    var host = this.getAttribute('data-host');
                                    toggleGroup(host);
                                })
                                var groupHolder = createElement('div', { 'class': 'group-holder', rel: host, styles: { 'display': 'none' } });
                                $(into).appendChild(groupHolder);
                                groups.set(host, {
                                    title: groupEl,
                                    holder: groupHolder,
                                    label: groupEl.querySelector('label.group-title-toggle-count')
                                });
                                if (ibcv == 'white') {
                                    ibcv = 'grey';
                                } else {
                                    ibcv = 'white';
                                }
                            }

                            var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                            var rawUrl = rha[thisc.counter].url || '';
                            var rawTime = rha[thisc.counter].time || '';
                            var displayTitleText = rha[thisc.counter].title || '';
                            var escapedUrlAttr = escapeHtmlAttr(rawUrl);
                            // The time is interpolated twice, once per context:
                            // in a rel attribute and as the visible text. One
                            // escaper per context, so the name records which.
                            var escapedTimeAttr = escapeHtmlAttr(rawTime);
                            var escapedTimeText = escapeHtmlText(rawTime);
                            // Text content, so escapeHtmlText: it leaves quotes
                            // alone, which escapeHtmlAttr would rewrite to
                            // &quot;. Both render alike, but only one of them
                            // records what the value was escaped for.
                            var escapedDisplayTitle = escapeHtmlText(displayTitleText);

                            var tooltipParts = [];
                            if (displayTitleText) {
                                tooltipParts.push(displayTitleText);
                            }
                            if (!isBookmarkletUrl(rawUrl) && rawUrl) {
                                tooltipParts.push(rawUrl);
                            }
                            if (rawTime) {
                                tooltipParts.push(rawTime);
                            }
                            var tooltipText = tooltipParts.join(' | ');
                            if (!tooltipText) {
                                tooltipText = isBookmarkletUrl(rawUrl) ? '[Bookmarklet]' : rawUrl;
                            }
                            var escapedTooltip = escapeHtmlAttr(tooltipText);

                            var item;
                            item = '<div class="item">';
                            item += '<span class="checkbox"><label><input class="chkbx bookmark-checkbox" type="checkbox" id="' + selectid + '" value="' + escapedUrlAttr + '" name="check"></label>&nbsp;</span>';
                            item += '<span class="time">' + escapedTimeText + '</span>';
                            item += '<a style="padding-left:0;" target="_blank" class="link" href="' + escapedUrlAttr + '">';
                            item += '<span class="title" title="' + escapedTooltip + '" rel="' +  escapedTimeAttr +  '">' + escapedDisplayTitle + '</span>';
                            item += '</a>';
                            item += '</div>';
                            // Built above, so the Map answers what used to be
                            // four container scans per item.
                            var group = groups.get(host);
                            // No inline colour is copied from the group title.
                            // A grouped row shows the title's colour only while
                            // the title is what carries it; selecting the group
                            // repaints the title and the row must follow, which
                            // a copy frozen at render time can never do (and it
                            // outranks the stylesheet, so the row stays wrong).
                            // The row's own `rel` is the colour it is entitled
                            // to. Same reasoning as markBookmarkedRow(), which
                            // paints the title rather than the row.
                            var itemHolder = createElement('div', {
                                'rel': ibcv,
                                'class': 'item-holder',
                                'data-bookmark-id': rha[thisc.counter].bookmarkId,
                                'data-bookmark-title': rha[thisc.counter].originalTitle,
                                'data-bookmark-url': rha[thisc.counter].url
                            });
                            itemHolder.innerHTML = item + '<div class="clearitem" style="clear:both;"></div>';
                            var groupDiv = group ? group.holder : null;
                            if (groupDiv) groupDiv.appendChild(itemHolder);
                            else $(into).appendChild(itemHolder);
                            var linkElement = itemHolder.querySelector('a.link');
                            if (linkElement) {
                                linkElement.addEventListener('click', function (e) {
                                    var holder = this.closest('div.item-holder');
                                    var linkUrl = holder ? holder.getAttribute('data-bookmark-url') : null;
                                    if (linkUrl && isBookmarkletUrl(linkUrl)) {
                                        e.preventDefault();
                                        executeBookmarklet(linkUrl, {
                                            decode: true,
                                            fallbackToUpdate: true,
                                            onFailure: function(err) {
                                                console.warn('Bookmarklet execution failed:', err);
                                            }
                                        });
                                    }
                                });
                            }
                            $(selectid).addEventListener('click', function () {
                                selectBookmarkItem(this, 'single');
                            });

                            var size = groupDiv ? groupDiv.childNodes.length : 0;
                            var label = group ? group.label : null;
                            if (label != undefined && label != null)
                                label.textContent = size;
                        }
                        thisc.counter++;
                    }
                    if (thisc.counter >= rha.length) {
                        clearInterval(prh);
                        alertLoadingHistory(true);
                        var uioneInput = document.body.querySelector('#rh-bar-uione input');
                        if (uioneInput) uioneInput.checked = false;
                        // Tips removed - native title provides tooltip
                        var gts = $$('#' + into + ' div.group-title');
                        if (gts.length > 0) { toggleGroup(gts[0].getAttribute('title')); }
                        $('master-check-all').removeAttribute('disabled');
                    }
                }).bind(Counter), 5);
            } else if (grp == 'no') {
                prh = setInterval((function () {
                    var thisc = this;
                    var deadline = Date.now() + RENDER_BUDGET_MS;
                    while (thisc.counter < rha.length && Date.now() < deadline) {
                        if (rha[thisc.counter] !== undefined) {

                            var selectid = 'select-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                            var errorid = 'error-' + Math.floor((Math.random() * 999999999999999999) + 100000000000000000);
                            var rawUrl = rha[thisc.counter].url || '';
                            var rawTime = rha[thisc.counter].time || '';
                            var displayTitleText = rha[thisc.counter].title || '';
                            var escapedUrlAttr = escapeHtmlAttr(rawUrl);
                            // The time is interpolated twice, once per context:
                            // in a rel attribute and as the visible text. One
                            // escaper per context, so the name records which.
                            var escapedTimeAttr = escapeHtmlAttr(rawTime);
                            var escapedTimeText = escapeHtmlText(rawTime);
                            // Text content, so escapeHtmlText: it leaves quotes
                            // alone, which escapeHtmlAttr would rewrite to
                            // &quot;. Both render alike, but only one of them
                            // records what the value was escaped for.
                            var escapedDisplayTitle = escapeHtmlText(displayTitleText);

                            var tooltipParts = [];
                            if (displayTitleText) {
                                tooltipParts.push(displayTitleText);
                            }
                            if (!isBookmarkletUrl(rawUrl) && rawUrl) {
                                tooltipParts.push(rawUrl);
                            }
                            if (rawTime) {
                                tooltipParts.push(rawTime);
                            }
                            var tooltipText = tooltipParts.join(' | ');
                            if (!tooltipText) {
                                tooltipText = isBookmarkletUrl(rawUrl) ? '[Bookmarklet]' : rawUrl;
                            }
                            var escapedTooltip = escapeHtmlAttr(tooltipText);

                            var faviconUrl = rha[thisc.counter].favicon || '';
                            var item;
                            item = '<div class="item">';
                            item += '<span class="checkbox"><label><input class="chkbx bookmark-checkbox" type="checkbox" id="' + selectid + '" value="' + escapedUrlAttr + '" name="check"></label>&nbsp;</span>';
                            item += '<span class="time">' + escapedTimeText + '</span>';
                            item += '<a target="_blank" class="link" href="' + escapedUrlAttr + '">';
                            item += '<img id="' + errorid + '" class="favicon" alt="Favicon">';
                            item += '<span class="title" title="' + escapedTooltip + '" rel="'  + escapedTimeAttr +  '">' + escapedDisplayTitle + '</span>';
                            item += '</a>';
                            item += '</div>';
                            var itemHolder = createElement('div', { 
                                'rel': ibcv, 
                                'class': 'item-holder',
                                'data-bookmark-id': rha[thisc.counter].bookmarkId,
                                'data-bookmark-title': rha[thisc.counter].originalTitle,
                                'data-bookmark-url': rha[thisc.counter].url
                            });
                            itemHolder.innerHTML = item + '<div class="clearitem" style="clear:both;"></div>';
                            $(into).appendChild(itemHolder);
                            var linkElement = itemHolder.querySelector('a.link');
                            if (linkElement) {
                                linkElement.addEventListener('click', function (e) {
                                    var holder = this.closest('div.item-holder');
                                    var linkUrl = holder ? holder.getAttribute('data-bookmark-url') : null;
                                    if (linkUrl && isBookmarkletUrl(linkUrl)) {
                                        e.preventDefault();
                                        executeBookmarklet(linkUrl, {
                                            decode: true,
                                            fallbackToUpdate: true,
                                            onFailure: function(err) {
                                                console.warn('Bookmarklet execution failed:', err);
                                            }
                                        });
                                    }
                                });
                            }


                            if (ibcv == 'white') {
                                ibcv = 'grey';
                            } else {
                                ibcv = 'white';
                            }
                            $(selectid).addEventListener('click', function () {
                                selectBookmarkItem(this, 'single');
                            });
                            var _faviconFallbackUrl = getFaviconOnerror(rha[thisc.counter].url);
                            setupFaviconElement($(errorid), faviconUrl, _faviconFallbackUrl);
                        }
                        thisc.counter++;
                    }
                    if (thisc.counter >= rha.length) {
                        clearInterval(prh);
                        alertLoadingHistory(true);
                        var uioneInput = document.body.querySelector('#rh-bar-uione input');
                        if (uioneInput) uioneInput.checked = false;
                        // Tips removed - native title provides tooltip
                        var gts = $$('#' + into + ' div.group-title');
                        if (gts.length > 0) { toggleGroup(gts[0].getAttribute('title')); }
                        $('master-check-all').removeAttribute('disabled');
                    }
                }).bind(Counter), 5);
            }
            alertLoadingHistory(true);
        } else {
            alertLoadingHistory(true);
            // $('calendar-total-value').set('text', '0');
            $(into).innerHTML = '<div class="no-results"><span>' + returnLang('noResults') + '</span></div>';
        }

    }


    function deleteBookmarkItems() {
        var into = getActiveBookmark() == 'history' ? '#rh-views-insert' : '#rh-views-search-insert';
        var checkedItems = $$(into + ' .chkbx:checked');
        
        if (checkedItems.length > 0) {
            var confirmMsg = returnLang('ui4');
            if (confirm(confirmMsg)) {
                alertLoadingHistory(false);
                var deleteCount = 0;
                var totalCount = checkedItems.length;
                
                for (var i = 0; i < checkedItems.length; i++) {
                    (function(el) {
                        var holder = el.closest('div.item-holder');
                        // holder.remove() runs in the chrome.bookmarks.remove()
                        // callback below, so a second sweep can meet a checkbox
                        // whose row has already been detached.
                        if (!holder) return;
                        var bookmarkId = holder.getAttribute('data-bookmark-id');
                        
                        if (bookmarkId) {
                            chrome.bookmarks.remove(bookmarkId, function() {
                                deleteCount++;
                                holder.remove();
                                
                                if (deleteCount == totalCount) {
                                    $('master-check-all').checked = false;
                                    $('master-check-all').value = 'false';
                                    updateBookmarkButtons();
                                    alertLoadingHistory(true);
                                }
                            });
                        } else {
                            deleteCount++;
                            if (deleteCount == totalCount) {
                                alertLoadingHistory(true);
                            }
                        }
                    })(checkedItems[i]);
                }
            }
        }
    }


    function resetBookmarkSelectionState() {
        if ($('master-check-all')) {
            $('master-check-all').checked = false;
            $('master-check-all').value = 'false';
        }
        updateBookmarkButtons();
    }


    function refreshBookmarkView() {
        var activeView = getActiveBookmark();
        var query = $('rh-search') ? $('rh-search').value : '';
        if (activeView === 'search' && query && (query.length + query.replace(/[0-9a-zA-Z]+/g, '').length >= 2)) {
            bookmark('search', query);
        } else {
            bookmark('yes', '');
        }
    }


    function getBookmarkContainerSelector() {
        return getActiveBookmark() == 'search' ? '#rh-views-search-insert' : '#rh-views-insert';
    }


    function getBookmarkDataFromCheckbox(checkbox) {
        var holder = checkbox.closest('div.item-holder');
        if (!holder) {
            return null;
        }
        return {
            id: holder.getAttribute('data-bookmark-id'),
            title: holder.getAttribute('data-bookmark-title'),
            url: holder.getAttribute('data-bookmark-url'),
            holder: holder
        };
    }


    function editBookmarkItem() {
        var containerSelector = getBookmarkContainerSelector();
        var checkedItems = $$(containerSelector + ' .chkbx:checked');

        if (checkedItems.length !== 1) {
            return;
        }

        var data = getBookmarkDataFromCheckbox(checkedItems[0]);
        if (!data || !data.id) {
            return;
        }

        var currentTitle = data.title || data.url || '';
        var currentUrl = data.url || '';

        var newTitle = prompt(returnLang('editBookmarkTitlePrompt'), currentTitle);
        if (newTitle === null) {
            return;
        }
        newTitle = newTitle.trim();
        if (newTitle === '') {
            newTitle = currentTitle;
        }

        var newUrl = prompt(returnLang('editBookmarkUrlPrompt'), currentUrl);
        if (newUrl === null) {
            return;
        }
        newUrl = newUrl.trim();
        if (newUrl === '') {
            newUrl = currentUrl;
        }

        if (newTitle === currentTitle && newUrl === currentUrl) {
            return;
        }

        chrome.bookmarks.update(data.id, { title: newTitle, url: newUrl }, function () {
            if (chrome.runtime.lastError) {
                alert('Error updating bookmark: ' + chrome.runtime.lastError.message);
                return;
            }
            resetBookmarkSelectionState();
            refreshBookmarkView();
        });
    }

    });

});

export { selectBookmarkItem };
