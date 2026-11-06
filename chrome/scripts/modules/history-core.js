// Tree Style History - History Core Module
// History page display functions extracted from func.js

import { $, $$, createElement } from '../dom-helper.js';
import { returnLang, TimeToStr, formatDate, truncate, get_host, getFaviconUrl, getFaviconOnerror, setupFaviconElement, escapeHtmlAttr, escapeHtmlText, uniqueId } from './helpers.js';
import { filtUrl } from './config.js';
// Straight from the bottom layer, not via calendar.js: that module imports
// `history` from here, and going through it closed an import cycle.
// `dayKey` is imported as well as used by calendar.js: the answer to "is the
// day on screen today?" has to be the *same* expression on both sides.
import { save_calendar_storage2, dayKey } from './shared/calendar-storage.js';
import { paintSelectedDay } from './calendar-colors.js';
import { modifierState, ITEM_SELECTED_COLOR, RENDER_BUDGET_MS } from './ui-state.js';
import { showLoading, showNoResults } from './list-status.js';

// Module-level variables
var selectedItem;
var prh;

// The page's own <title>, captured before any transient status replaces it.
// Restoring a hard-coded string here used to leave the English UI (and the
// label) inconsistent with the shipped HTML title.
var initialTitle = (typeof document !== 'undefined') ? (document.title || '') : '';

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

/**
 * Report a day that has nothing in it: total 0, an empty list, no colour.
 *
 * The repaint is the point. `calendar()` paints the month from the map, and
 * deleteHistoryItem('range') runs it *before* the follow-up `history()` call —
 * so on the way in the square still has its old count and is drawn in its old
 * colour. Whatever erases that has to be here: the map entry is gone by now,
 * but the DOM keeps what calendar() last wrote, and a cell reading "0" next to
 * a dark green square is exactly the bug this round is about.
 *
 * `paintSelectedDay(0)` is a level-0 paint, which clears `style` — there is no
 * separate "uncolour" path to keep in step.
 *
 * Only the day view owns those two DOM nodes. `history('search', q)` reaches
 * here too when a keyword matches nothing, and a search says nothing about the
 * day the calendar happens to be showing: clearing its total and its colour
 * would leave "0 / uncoloured" next to a day that still has rows.
 */
function finishEmptyDay(into) {
    if (into == 'rh-views-insert') {
        $('calendar-total-value').textContent = '0';
        paintSelectedDay(0);
    }
    showNoResults(into);
}

function history(w, q) {

    var sw = $('rh-what').options[$('rh-what').selectedIndex].value;
    var grp = localStorage['rh-group'];
    var oby = localStorage['rh-orderby'];
    var ord = localStorage['rh-order'];
    var obj = {};
    var rha = [];

    if (prh) {
        clearInterval(prh);
    }

    if (w == 'yes' || w == 'current') {
        if (w == 'yes') {
            var day = Number($('date-select-day').options[$('date-select-day').selectedIndex].value);
            var month = Number($('date-select-month').options[$('date-select-month').selectedIndex].value) - 1;
            var year = Number($('date-select-year').options[$('date-select-year').selectedIndex].value);
            var today = new Date(year, month, day, 23, 59, 59, 999);
        } else if (w == 'current') {
            var ndc = new Date();
            today = new Date(ndc.getFullYear(), ndc.getMonth(), ndc.getDate(), 23, 59, 59, 999);
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
            day = Number($('date-select-day').options[$('date-select-day').selectedIndex].value);
            month = Number($('date-select-month').options[$('date-select-month').selectedIndex].value) - 1;
            year = Number($('date-select-year').options[$('date-select-year').selectedIndex].value);
            var ndate = new Date(year, month, day, 23, 59, 59, 999);
            eTime = ndate.getTime();
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
        into = 'rh-views-search-insert';
        $('rh-views-search-insert').style.display = 'block';
        $('rh-views-insert').style.display = 'none';
    }

    showLoading(into);

    chrome.history.search(obj, function (hi) {

        // `overwrite` = "nothing can have counted this day more recently
        // than the loop above", and there is exactly one day for which
        // that holds: today. The map's other writer is the crawl, and it
        // only fills gaps — it cannot reach today at all (saveCrawledHeat()
        // skips it), so today has one author and it has just spoken.
        //
        // For any other day the page is *not* authoritative. The dropdown
        // is not necessarily on today: clicking a calendar cell rewrites
        // it. Claiming otherwise would replace the crawl's *visit* count
        // for that day with the page's *row* count — one column of the map
        // silently switching measures — so older days go through the same
        // gap-filling path the crawl uses.
        var isToday = dayKey(obj['endTime']) === dayKey(Date.now());

        if (hi.length > 0) {

            alertLoadingHistory(false);

            for (var i = 0; i < hi.length; i++) {

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
                            // Stored raw: this title is displayed verbatim by
                            // the render loops below, which escape it for the
                            // text position themselves. It used to go through
                            // title_fix() here, which deleted '<', '>' and '/'
                            // — so "Docs / API" showed up as "Docs  API", and
                            // its partial escaping of '"' meant escaping it
                            // again at render time displayed a literal '&#34;'.
                            // Truncate before escaping: escaping first can cut
                            // an entity in half.
                            rha.push({ epoch: hi[i].lastVisitTime, url: url, host: get_host(url), time: TimeToStr(hi[i].lastVisitTime, true, true, false), date: formatDate(hi[i].lastVisitTime), favicon: furl, title: truncate(title, 0, 100), visits: visits });
                        }

                    }

                }

            }

            if (rha.length > 0) {

                $('master-check-all').disabled = true;

                if (into == 'rh-views-insert') {
                    var rhat = rha.length;
                    $('calendar-total-value').textContent = rhat;
                    // One shared paint for the selected cell, the same tiers
                    // every other cell is painted with. This used to be four
                    // inline branches that duplicated calendar.js's colours —
                    // and, critically, they were the *only* thing that ever
                    // coloured the selected day: calendar() skipped it, so a
                    // day stayed blank until it had been clicked at least once.
                    paintSelectedDay(rhat);
                }

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
                // host -> { title, holder }, filled as groups are created. The
                // render loop used to look the group up with three
                // querySelector() calls per item — each one a full scan of the
                // container — which made rendering O(items x hosts). The
                // container was cleared just above, so this starts empty.
                var groups = new Map();

                if (grp == 'yes') {
                    prh = setInterval(function () {
                        var thisc = Counter;
                        var deadline = Date.now() + RENDER_BUDGET_MS;
                        while (thisc.counter < rha.length && Date.now() < deadline) {
                            if (rha[thisc.counter] !== undefined) {
                                var hostKey = rha[thisc.counter].host;
                                if (!groups.has(hostKey)) {
                                    var toggleid = uniqueId('toggle');
                                    var moreid = uniqueId('more');
                                    var errorid = uniqueId('error');
                                    var groupid = uniqueId('group');
                                    var faviconUrl = rha[thisc.counter].favicon || '';
                                    // The host reaches attributes three times and
                                    // the visible label once — one escaper per
                                    // context. All four used to be raw.
                                    var hostAttr = escapeHtmlAttr(rha[thisc.counter].host);
                                    var hostText = escapeHtmlText(rha[thisc.counter].host.replace('www.', ''));
                                    var groupDiv = createElement('div', {
                                        title: rha[thisc.counter].host,
                                        rel: ibcv,
                                        'class': 'item-holder group-title ',
                                        html: '<a href="#" class="group-title-toggle" id="' + toggleid + '" data-host="' + hostAttr + '" rel="' + hostAttr + '"></a><input type="checkbox" class="group-title-checkbox" id="' + moreid + '" value="' + hostAttr + '"><img id="' + errorid + '" class="group-title-favicon" alt="Favicon"><span id="' + groupid + '" data-host="' + hostAttr + '" class="group-title-host">' + hostText + '</span>'
                                    });
                                    $(into).appendChild(groupDiv);
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
                                    });
                                    var holderDiv = createElement('div', { 'class': 'group-holder', rel: rha[thisc.counter].host, styles: { 'display': 'none' } });
                                    $(into).appendChild(holderDiv);
                                    groups.set(hostKey, { title: groupDiv, holder: holderDiv });
                                    if (ibcv == 'white') {
                                        ibcv = 'grey';
                                    } else {
                                        ibcv = 'white';
                                    }
                                }
                                if (w == 'search' && (sw == 'all' || sw == 'recent')) {
                                    // rha[thisc.counter].time = '- - : - -';
                                }
                                var selectid = uniqueId('select');
                                // The URL is attacker-controllable (it is whatever
                                // the page asked for), so it is escaped before it
                                // reaches href/value/title. Those are attributes,
                                // hence escapeHtmlAttr. The visible title is text
                                // content, so it takes escapeHtmlText: a page
                                // title is attacker-controllable too, and it was
                                // interpolated raw here — the only thing that
                                // made it safe was title_fix() deleting the angle
                                // brackets upstream, which the storage side no
                                // longer does.
                                var urlAttr = escapeHtmlAttr(rha[thisc.counter].url);
                                var tipAttr = escapeHtmlAttr(returnLang('visits') + ': ' + rha[thisc.counter].visits + ' | ' + rha[thisc.counter].time + ' ' + rha[thisc.counter].date);
                                var titleText = escapeHtmlText(rha[thisc.counter].title);
                                var item;
                                item = '<div class="item">';
                                item += '<span class="checkbox"><label><input class="chkbx" type="checkbox" id="' + selectid + '" value="' + urlAttr + '" name="check"></label>&nbsp;</span>';
                                item += '<span class="time">' + rha[thisc.counter].time + '</span>';
                                item += '<a style="padding-left:0;" target="_blank" class="link" href="' + urlAttr + '">';
                                item += '<span class="title" title="' + urlAttr + '" rel="' + tipAttr + '">' + titleText + '</span>';
                                item += '</a>';
                                item += '</div>';
                                // The holder was built above, so the Map
                                // answers what used to be two container scans.
                                var group = groups.get(hostKey);
                                var itemHolder = createElement('div', {
                                    'rel': ibcv,
                                    'class': 'item-holder'
                                });
                                itemHolder.innerHTML = item;
                                var groupHolder = group ? group.holder : null;
                                if (groupHolder) {
                                    groupHolder.appendChild(itemHolder);
                                } else {
                                    $(into).appendChild(itemHolder);
                                }
                                $(selectid).addEventListener('click', function () {
                                    selectHistoryItem(this, 'single');
                                });
                            }
                            thisc.counter++;
                        }
                        if (thisc.counter >= rha.length) {
                            clearInterval(prh);
                            alertLoadingHistory(true);
                            var input = document.body.querySelector('#rh-bar-uione input');
                            if (input) input.checked = false;
                            selectedItem = undefined;
                            if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].getAttribute('title')); }
                            $('master-check-all').removeAttribute('disabled');
                        }
                    }.bind(Counter), 5);
                } else if (grp == 'no') {
                    prh = setInterval(function () {
                        var thisc = Counter;
                        var deadline = Date.now() + RENDER_BUDGET_MS;
                        while (thisc.counter < rha.length && Date.now() < deadline) {
                            if (rha[thisc.counter] !== undefined) {
                                if (w == 'search' && (sw == 'all' || sw == 'recent')) {
                                    // rha[thisc.counter].time = '- - : - -';
                                }
                                var selectid = uniqueId('select');
                                var errorid = uniqueId('error');
                                var faviconUrl = rha[thisc.counter].favicon || '';
                                // See the grouped branch: the URL is escaped for
                                // the attributes (escapeHtmlAttr), the visible
                                // title for a text position (escapeHtmlText).
                                var urlAttr = escapeHtmlAttr(rha[thisc.counter].url);
                                var tipAttr = escapeHtmlAttr(returnLang('visits') + ': ' + rha[thisc.counter].visits + ' | ' + rha[thisc.counter].time + ' ' + rha[thisc.counter].date);
                                var titleText = escapeHtmlText(rha[thisc.counter].title);
                                var item;
                                item = '<div class="item">';
                                item += '<span class="checkbox"><label><input class="chkbx" type="checkbox" id="' + selectid + '" value="' + urlAttr + '" name="check"></label>&nbsp;</span>';
                                item += '<span class="time">' + rha[thisc.counter].time + '</span>';
                                item += '<a target="_blank" class="link" href="' + urlAttr + '">';
                                item += '<img id="' + errorid + '" class="favicon" alt="Favicon">';
                                item += '<span class="title" title="' + urlAttr + '" rel="' + tipAttr + '">' + titleText + '</span>';
                                item += '</a>';
                                item += '</div>';
                                var itemHolder = createElement('div', { 'rel': ibcv, 'class': 'item-holder ' });
                                itemHolder.innerHTML = item;
                                $(into).appendChild(itemHolder);

                                if (ibcv == 'white') {
                                    ibcv = 'grey';
                                } else {
                                    ibcv = 'white';
                                }
                                $(selectid).addEventListener('click', function () {
                                    selectHistoryItem(this, 'single');
                                });
                                var _faviconFallbackUrl = getFaviconOnerror(rha[thisc.counter].url);
                                setupFaviconElement($(errorid), faviconUrl, _faviconFallbackUrl);
                            }
                            thisc.counter++;
                        }
                        if (thisc.counter >= rha.length) {
                            clearInterval(prh);
                            alertLoadingHistory(true);
                            var input = document.body.querySelector('#rh-bar-uione input');
                            if (input) input.checked = false;
                            selectedItem = undefined;
                            if ($$('#' + into + ' div.group-title').length > 0) { toggleGroup($$('#' + into + ' div.group-title')[0].getAttribute('title')); }
                            $('master-check-all').removeAttribute('disabled');
                        }
                    }.bind(Counter), 5);
                }
                alertLoadingHistory(true);
            } else {
                alertLoadingHistory(true);
                finishEmptyDay(into);
            }

        } else {
            finishEmptyDay(into);
        }

        // Written here, once, for every outcome — including "no rows at
        // all". A day with no rows still says something, and it is the
        // *empty* case that matters most: save_calendar_storage2() deletes
        // the entry when `n < 1`, and nothing else in the extension
        // removes a heat-map entry, so a call that only ever happened for
        // a non-empty list could never clean up. Deleting a day's history
        // left the square coloured for good.
        save_calendar_storage2(obj, rha.length, isToday);

    });

}

// --- Group toggle ---

function toggleGroup(host) {
    if (getActiveHistory() == 'history') {
        var into = 'rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        into = 'rh-views-search-insert';
    }
    // The host comes from a visited URL, and a quote in it would close the
    // attribute selector early — querySelector() throws rather than returning
    // null, which propagates out of the chunked render loop and leaves the page
    // half drawn.
    var tgda = $(into).querySelector('a[rel="' + CSS.escape(host) + '"]');
    var tgde = $(into).querySelector('div[rel="' + CSS.escape(host) + '"]');

    if (tgda != undefined && tgde != undefined) {
        var tgdv = tgde.style.display;
        if (tgdv == 'block') {
            tgde.style.display = 'none';
            tgda.setAttribute('data-expanded', 'false');
        } else {
            tgde.style.display = 'block';
            tgda.setAttribute('data-expanded', 'true');
        }
    } else {
        // Reached when the group is not in the DOM: the render loop was
        // interrupted (a delete in flight, a filtered repaint) or the caller
        // passed a host that never got a group. Silence would make a toggle
        // that does nothing look like a dead page.
        console.warn('toggleGroup(): no group for ' + JSON.stringify(host));
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

/**
 * Repaint the nearest ancestor matching `selector`.
 *
 * The ancestor can be missing: deleteHistoryItem('selected') detaches
 * `div.item-holder` rows, and a sweep over every `.chkbx` then meets checkboxes
 * whose row is already gone. closest() returns null there, so the write has to
 * be skipped — one `null.style` throws and aborts the whole repaint, leaving
 * the list half updated.
 */
function paintClosest(el, selector, color) {
    var node = el.closest(selector);
    if (node) node.style.backgroundColor = color;
}

/**
 * Drop the inline colour a row carries, leaving the CSS one to show through.
 *
 * Selecting a row means writing `ITEM_SELECTED_COLOR` into it; unselecting
 * therefore means *removing that write*, not writing a colour back. The colour
 * a row is supposed to return to comes from `div[rel="white"]` / `div[rel="grey"]`
 * in history.css — and that CSS is a different pair of values per theme
 * (`#fff`/`#fafafa` in light, `#555`/`#444` in dark). Writing a literal back
 * gets both halves wrong: `#fafafa` is not the grey row in dark mode either,
 * and no literal can follow a user who switches theme.
 *
 * An emptied inline value is also what the row starts with, so an unselect
 * restores exactly the properties the select wrote.
 */
function clearRowColor(row) {
    if (row) row.style.backgroundColor = '';
}

/**
 * Where a grouped row sits: the container it was drawn in and the host it was
 * grouped under.
 *
 * Both halves of the group rule start here — the title to paint and the group's
 * own checkboxes deciding whether it should still be painted — so they cannot
 * disagree about which group a row is in. Null for an ungrouped row, and for a
 * row that has been detached: `closest()` answers with a subtree that is no
 * longer in the document, and its host cannot be resolved against anything.
 *
 * `view` is the container the group was drawn in, which is where the title
 * lives: both list pages keep TWO containers in the DOM (main list and search
 * results) and switch between them by `display`, so "the title of this group"
 * is only answerable inside the one the row came from.
 */
function groupOf(checkbox) {
    var holder = checkbox.closest('div.group-holder');
    if (!holder) return null;
    var view = holder.parentNode;
    if (!view) return null;
    return { view: view, host: holder.getAttribute('rel') };
}

/**
 * The `div.group-title` carrying `host` inside `view`, or null.
 *
 * Matched by hand rather than with `div.group-title[title="<host>"]`: the host
 * goes into an attribute value, so a quote in it would make that selector
 * syntactically invalid and `querySelector` would throw. Every row of a group
 * is a sibling of its holder, so the titles are one level up and a walk of
 * `children` is the whole list.
 */
function titleInContainer(view, host) {
    for (var i = 0; i < view.children.length; i++) {
        var el = view.children[i];
        if (el.getAttribute('title') == host
            && (' ' + el.className + ' ').indexOf(' group-title ') >= 0) {
            return el;
        }
    }
    return null;
}

/**
 * The group title a row belongs to, or null when it is not grouped.
 *
 * Grouping wraps rows in `div.group-holder[rel=host]` and the title above it
 * carries the same host in `title`. Shared by the unselect sweep so a grouped
 * row and its title are always cleared as a pair — clearing only the row
 * leaves the title pink, which is one of the two ways this used to go wrong.
 *
 * Both list pages group their rows the same way, so bookmark.js imports this
 * rather than keeping its own copy: the two copies had already drifted (one
 * reached the title through a document-wide query, the other did not) and
 * "which element carries a grouped row's colour" is one rule, not two.
 *
 * Resolved from the holder's own container, not from `document`. Both pages
 * keep the main list and the search results in the DOM at the same time and
 * switch views by `display` alone, so the same host has a title in each — and
 * a document-wide query returns the first one in document order, which is the
 * main list's no matter which view the row came from. Unselecting everything
 * in the search view then cleared the main list's title while its group
 * checkbox stayed ticked. Every other lookup in this file already scopes
 * itself the same way (`$$(into + ' div[title="…"]')`,
 * `document.querySelector(into + ' …')`).
 */
function groupTitleOf(checkbox) {
    var group = groupOf(checkbox);
    return group ? titleInContainer(group.view, group.host) : null;
}

function getMoreItems(el) {
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        into = '#rh-views-search-insert';
    }
    var ihost = el.value;
    if (el.checked == false) {
        Array.from($$(into + ' .chkbx')).forEach(function (ele) {
            var eleh = get_host(ele.value);
            if (ihost == eleh) {
                ele.checked = false;
                var parentHolder = ele.closest('div.item-holder');
                clearRowColor(parentHolder);
                clearRowColor(el.closest('div.group-title'));
            }
        });
    } else if (el.checked == true) {
        Array.from($$(into + ' .chkbx')).forEach(function (ele) {
            var eleh = get_host(ele.value);
            if (ihost == eleh) {
                ele.checked = true;
                paintClosest(el, 'div.group-title', ITEM_SELECTED_COLOR);
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

// --- Select history item ---

function selectHistoryItem(el, w) {
    var grp = localStorage['rh-group'];
    if (getActiveHistory() == 'history') {
        var into = '#rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        into = '#rh-views-search-insert';
    }
    if (w == 'single') {
        if (el.checked == true) {
            if (modifierState.shift && selectedItem !== undefined) {
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
                            clearRowColor(chkbxs[i].closest('div.item-holder'));
                        } else if (chkbxs[i].checked == false) {
                            chkbxs[i].checked = true;
                            paintClosest(chkbxs[i], 'div.item-holder', ITEM_SELECTED_COLOR);
                        }
                    }
                }
            }
            selectedItem = el;
            paintClosest(el, 'div.item-holder', ITEM_SELECTED_COLOR);
        } else if (el.checked == false) {
            selectedItem = undefined;
            var iurl = el.value;
            Array.from($$(into + ' .chkbx')).forEach(function (ele) {
                if (ele.value == iurl) {
                    clearRowColor(ele.closest('div.item-holder'));
                    // The title is left to the recompute below, which is the
                    // only place that decides it: this sweep cannot tell
                    // "last ticked row of the group" from "row I am looking at"
                    // — it walks rows one at a time, and the state it reads
                    // is the one from before this click landed.
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
        // One place decides a group title's colour, and it is this one: the
        // row sweeps above cannot, because they walk rows one at a time and
        // read the state from before the click landed.
        if (grp == 'yes') {
            var elem = el.closest('.group-holder');
            if (elem) {
                var chkbxCount = elem.querySelectorAll('.chkbx').length;
                var chkbxChecked = elem.querySelectorAll('.chkbx:checked').length;
                var titleDiv = groupTitleOf(el);
                if (titleDiv) {
                    // "Anything left" is what the title stands for, not "all of
                    // them": a group with no row ticked and a group with every
                    // row ticked both answer `count == checked` (0 == 0, n ==
                    // n), so that equality cannot tell *painted* from
                    // *released* — unticking one row out of two landed on the
                    // release branch and left the still-ticked sibling
                    // unmarked, with the delete button still live for it. The
                    // equality still drives the title's own checkbox, which is
                    // the one thing that literally means "all of them".
                    if (chkbxChecked > 0) {
                        titleDiv.style.backgroundColor = ITEM_SELECTED_COLOR;
                    } else {
                        clearRowColor(titleDiv);
                    }
                    var chkBox = titleDiv.querySelector('.group-title-checkbox');
                    if (chkBox) chkBox.checked = (chkbxCount == chkbxChecked);
                }
            }
        }
    } else if (w == 'all') {
        // Unselecting has to undo exactly what selecting wrote, on the same
        // elements: the row, plus the group title when the row has one. A
        // grouped row's colour and its title's are painted independently here
        // (the `grp` blocks below handle the titles for select-all), so the
        // sweep has to clear both — clearing only the row left the title pink.
        if (el.value == 'false') {
            Array.from($$(into + ' .chkbx')).forEach(function (ele) {
                ele.checked = true;
                paintClosest(ele, 'div.item-holder', ITEM_SELECTED_COLOR);
            });
            if (grp == 'yes') {
                Array.from($$(into + ' .group-title')).forEach(function (gel) {
                    var chkInput = gel.querySelector('input');
                    if (chkInput) chkInput.checked = true;
                    gel.style.backgroundColor = ITEM_SELECTED_COLOR;
                });
            }
            el.value = 'true';
        } else {
            Array.from($$(into + ' .chkbx')).forEach(function (ele) {
                ele.checked = false;
                clearRowColor(ele.closest('div.item-holder'));
            });
            if (grp == 'yes') {
                Array.from($$(into + ' .group-title')).forEach(function (gel) {
                    var chkInput = gel.querySelector('input');
                    if (chkInput) chkInput.checked = false;
                    clearRowColor(gel);
                });
            }
            el.value = 'false';
        }
    }
}

// --- Delete history item ---

/**
 * Delete history entries.
 *
 * `redraw` runs after a range delete has gone through, for the caller to
 * repaint whatever else shows per-day counts. It is a parameter rather than an
 * import because the one thing that needs repainting — the calendar — imports
 * history() from this file, and importing it back would make the module graph
 * cyclic (static.test.mjs asserts it is not).
 */
function deleteHistoryItem(w, redraw) {
    if (w == 'selected') {
        var grp = localStorage['rh-group'];
        if (getActiveHistory() == 'history') {
            var into = '#rh-views-insert';
        } else if (getActiveHistory() == 'search') {
            into = '#rh-views-search-insert';
        }
        if ($$(into + ' .checkbox input:checked').length > 0) {
            document.title = returnLang('deleting');
            alertLoadingHistory(true);
            Array.from($$(into + ' .checkbox input:checked')).forEach(function (el) {
                el.closest('div.item-holder').remove();
                // The row is already gone from the DOM, so a failed delete is
                // the one case where the user sees a rule that did nothing and
                // has no way to tell why: chrome.history.deleteUrl() reports
                // through chrome.runtime.lastError rather than throwing.
                chrome.history.deleteUrl({ url: el.value }, function () {
                    if (chrome.runtime.lastError) {
                        // One console line, not one alert per row: a delete of
                        // 50 rows behind a modal would be 50 dialogs.
                        console.warn('deleteUrl failed:', el.value, chrome.runtime.lastError.message);
                    }
                });
            });
            chrome.history.search({ text: '', maxResults: 1, startTime: (new Date()).getTime() - (24 * 3600 * 1000), endTime: (new Date()).getTime() }, function (hi) {
                if (grp == 'yes') {
                    Array.from($$(into + ' .group-holder')).forEach(function (gel) {
                        if (gel.querySelectorAll(':scope > div.item-holder').length == 0) {
                            var groupTitle = document.querySelector(into + ' .group-title[title="' + CSS.escape(gel.getAttribute('rel')) + '"]');
                            if (groupTitle) groupTitle.remove();
                            gel.remove();
                        }
                    });
                }
                document.title = initialTitle;
                alertLoadingHistory(true);
            });
        }
    } else if (w == 'range') {
        var df = localStorage['rh-date'];
        var dfrom = $('delete-range-one');
        var dto = $('delete-range-two');
        // rh-date is undefined until the storage cache is filled, and the two
        // inputs are empty until a date is picked. Both used to reach .split()
        // and throw; an unresolvable range should simply do nothing.
        if (!df || !dfrom || !dto || !dfrom.value || !dto.value) {
            console.warn('deleteHistoryItem(range): incomplete range, nothing deleted');
            return;
        }

        var dober = {};
        var dobsr = {};
        var dfs = df.split('/');
        var sr = dfrom.value.split('/');
        var er = dto.value.split('/');
        for (var d = 0; d < dfs.length; d++) {
            dobsr[dfs[d]] = sr[d];
            dober[dfs[d]] = er[d];
        }
        var startRange = new Date(dobsr['yyyy'], (dobsr['mm'] - 1), dobsr['dd'], 23, 59, 59, 999).getTime() - 86400000;
        var endRange = new Date(dober['yyyy'], (dober['mm'] - 1), dober['dd'], 23, 59, 59, 999).getTime();
        // Fields are mapped by position, so the values are only meaningful if
        // they were written in the format rh-date names. A mismatch (inputs
        // filled as mm/dd/yyyy while rh-date says yyyy/mm/dd) puts the day in
        // the year slot: `new Date(9, ...)` resolves to 1909, and a range
        // starting there deletes the entire history. A missing field lands in
        // the same place via NaN, so one check covers both.
        if (!Number.isFinite(startRange) || !Number.isFinite(endRange)
            || startRange < 0 || endRange < 0) {
            console.warn('deleteHistoryItem(range): unparsable range, nothing deleted',
                df, dfrom.value, dto.value);
            return;
        }
        if (startRange < endRange) {
            document.title = returnLang('deleting');
            alertUserHistory(true);
            chrome.history.deleteRange({ startTime: startRange, endTime: endRange }, function () {
                // `redraw` stands where `window.calendar('yes','')` used to be.
                // That call was always a TypeError — `calendar` is an ES module
                // export and nothing mounts it on `window` — and it cannot be
                // imported either: calendar.js imports history() from this file,
                // so importing it back would close a cycle.
                //
                // It runs before history() because history() only recolours the
                // selected day and refreshes the total; the heat map of every
                // other day in the month is calendar()'s, and a range delete can
                // change all of them.
                if (typeof redraw === 'function') redraw();
                history('yes', '');
                document.title = initialTitle;
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
    clearRowColor,
    groupTitleOf,
    selectHistoryItem,
    deleteHistoryItem,
    alertUserHistory,
    alertLoadingHistory
};