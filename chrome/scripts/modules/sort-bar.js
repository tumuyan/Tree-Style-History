// Tree Style History - shared sort/group toolbar for the two linear pages
//
// history.js and bookmark.js used to carry the same three click handlers and
// the same `style.backgroundPosition` toggles verbatim. Any change (a new sort
// mode, a tooltip, an aria-label) had to be made twice, in step. One of the two
// copies had already drifted: it read `getActiveHistory()` from history-core.js
// while its own `getActiveBookmark()` sat a few lines above, unused by the
// toolbar. This module owns the toolbar for both pages, but NOT the view
// detection: each page passes its own `getActive()` to initSortBar().
//
// The buttons are `<a href="#">` with no text, so their state is expressed as a
// `data-state` attribute and the icon is chosen in CSS. That keeps the visual
// rule in one place (and lets the dark theme / zoom restyle it) instead of
// hard-coding `backgroundPosition: left/right center` in JS.

import { $ } from '../dom-helper.js';
import { returnLang } from './helpers.js';

// The three keys are written only here and read by the render loops. The
// toolbar is the sole writer; see tests/static.test.mjs on why saveOptions()
// must not collect them.
const KEYS = {
    'rh-bar-group': 'rh-group',
    'rh-bar-orderby': 'rh-orderby',
    'rh-bar-order': 'rh-order',
};

// Two-state toggles. `order` has no tooltip of its own: both pages used a
// single i18n key for it.
const TOGGLES = {
    'rh-group': ['yes', 'no'],
    'rh-orderby': ['date', 'title'],
    'rh-order': ['desc', 'asc'],
};

function setState(id, value) {
    $(id).setAttribute('data-state', value);
}

function setHint(id, key) {
    var el = $(id);
    var text = returnLang(key);
    // `title` is both an attribute and a reflected DOM property; setting just
    // the attribute leaves `.title` stale in some contexts (and in the test
    // shim), so write both. `aria-label` has no reflected property.
    el.setAttribute('title', text);
    el.title = text;
    el.setAttribute('aria-label', text);
}

// Re-read the storage keys and paint the toolbar. Called once on load and
// after every toggle, so the buttons can never disagree with the list.
function paint() {
    for (const id in KEYS) {
        setState(id, localStorage[KEYS[id]]);
    }
    // `orderByTitle` / `orderByTime` describe the *next* click, matching the
    // tooltip the old handlers set. `group` and `order` are static hints.
    setHint('rh-bar-group', 'group');
    // The old handlers only special-cased 'title'; every other value (and a
    // cold-start undefined) advertised the click that switches to titles.
    setHint('rh-bar-orderby', localStorage['rh-orderby'] === 'title' ? 'orderByTime' : 'orderByTitle');
    setHint('rh-bar-order', 'order');
}

// Refresh whichever view the page currently shows. `refresh` is the page's own
// render function (history or bookmarks) and `getActive` is its own view
// detector: the two pages do not agree on how the initial view is represented
// (`getActiveHistory()` reads inline `style.display`, `getActiveBookmark()`
// falls back to computed style), so the toolbar must not pick one for them.
function refreshActive(refresh, getActive) {
    var active = getActive();
    if (active === 'search') {
        var q = $('rh-search').value;
        if (q.length > 0) {
            refresh('search', q);
        } else {
            refresh('yes', '');
        }
    } else {
        // 'history', or the raw initial state before any render set an inline
        // `display`: history.css gives the containers `inline` / `none`, so
        // BOTH detectors answer undefined there. Falling back to the full view
        // is what the old 'history' branch did and keeps a click on a cold page
        // from silently changing storage while leaving the list untouched.
        refresh('yes', '');
    }
}

/**
 * Wire the group / orderby / order buttons.
 *
 * @param {Function} refresh - page render function `(w, q)`, e.g. `history`
 *   from history-core.js or the local `bookmark()` in bookmark.js.
 * @param {Function} getActive - page view detector returning `'history'` or
 *   `'search'`, e.g. `getActiveHistory` / `getActiveBookmark`.
 */
export function initSortBar(refresh, getActive) {
    paint();

    for (const id in KEYS) {
        var el = $(id);
        // A page calls this once, but a re-render or a second bootstrap must
        // not stack handlers and toggle the state twice per click.
        if (el.getAttribute('data-sortbar-bound')) continue;
        el.setAttribute('data-sortbar-bound', '1');
        el.addEventListener('click', function () {
            var key = KEYS[id];
            var pair = TOGGLES[key];
            var current = localStorage[key];
            // Only a known first state flips back; anything else (including a
            // cold-start undefined) lands on the second one. The first click
            // therefore always produces a known, usable value.
            localStorage[key] = current === pair[1] ? pair[0] : pair[1];
            paint();
            refreshActive(refresh, getActive);
        });
    }
}
