// Tree Style History - page-shared DOM leaf helpers
//
// alertLoadingHistory() is used by all four list pages: the two linear pages
// (history.html / bookmark.html) and the two tree pages (history2.html /
// closed.html). getActiveHistory() / toggleGroup() serve the linear pages and
// the chunked renderer's end-of-list work only — the tree pages never open
// host groups or read the active list container.
// chunked-render.js needs these at the end of every list, but history-core.js
// already imports that renderer — importing back would close a cycle
// (tests/static.test.mjs has an acyclic guard). These leaf helpers therefore
// live here, with dom-helper.js as the only dependency: history-core.js
// re-exports them so the public API is unchanged.

import { $ } from '../dom-helper.js';

/** Which list container is on screen, by its inline style.display. */
export function getActiveHistory() {
    if ($('rh-views-insert').style.display == 'block') {
        return 'history';
    } else if ($('rh-views-search-insert').style.display == 'block') {
        return 'search';
    }
}

/** Hide (true) or reveal (false) the shared loading indicator. */
export function alertLoadingHistory(pm) {
    if (pm) {
        $('alert-holder').style.display = 'none';
        $('alert-holder-loading').style.marginTop = '-15px';
    } else if ($('alert-holder').style.display == 'none') {
        $('alert-holder').style.display = 'block';
    }
}

/**
 * Open or close the group for `host`.
 *
 * The host comes from a visited URL, and a quote in it would close the
 * attribute selector early — querySelector() throws rather than returning
 * null, which propagates out of the chunked render loop and leaves the page
 * half drawn.
 */
export function toggleGroup(host) {
    if (getActiveHistory() == 'history') {
        var into = 'rh-views-insert';
    } else if (getActiveHistory() == 'search') {
        into = 'rh-views-search-insert';
    }
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
