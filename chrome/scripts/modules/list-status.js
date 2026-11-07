// Tree Style History - list status for the two linear pages only
//
// history.html and bookmark.html used to write their "Loading..." and
// "no results" states by hand: `$(into).textContent = returnLang('loading')`
// in three places and a `<div class="no-results">` string in six. Every new
// state (progress, an error, a spinner) meant editing both render loops again.
// This module owns the two states for those two pages; the CSS owns their shape.
//
// The popup is NOT part of this: popup-core.js still writes its own
// `.no-results` markup and popup.css still styles it. Do not delete that rule
// on the assumption that every empty state goes through this module.

import { $ } from '../dom-helper.js';
import { returnLang, escapeHtmlText } from './helpers.js';

// A re-render used to collapse the list to nothing between "clear" and the
// first drawn row: the document lost hundreds of pixels of height for a frame,
// the vertical scrollbar went away with it, and everything on the page jumped
// 15px sideways while the view snapped back to the top. Both halves are fixed
// from here — the loading state now holds the height the list already had
// (`lockHeight`), and the finished render releases it (`unlockHeight`).

/**
 * Pin `el` to the height it currently occupies, in layout pixels.
 *
 * `getBoundingClientRect()` reports *scaled* pixels, and `applyZoom()` sets a
 * percentage `zoom` on `body`, so the value has to be divided out before it can
 * be written back as a `min-height` — otherwise an 80% zoom would reserve 1/0.8
 * of the real height and the page would grow instead of staying put.
 */
function lockHeight(el) {
    var height = el.getBoundingClientRect().height;
    var zoom = Number(getComputedStyle(document.body).zoom) || 1;
    if (height > 0) el.style.minHeight = (height / zoom) + 'px';
}

/** Drop the reservation made by lockHeight(), returning the element to flow. */
export function unlockHeight(into) {
    var el = $(into);
    if (el) el.style.minHeight = '';
}

/**
 * Replace a view container with the loading state.
 *
 * `role="status"` + `aria-live="polite"` make a chunked render reachable by a
 * screen reader: the rows are appended over several setInterval ticks, so a
 * reader that only looked at the final DOM would miss the interim state.
 *
 * The container keeps the height it had before the swap, so the swap is a
 * repaint rather than a reflow of the whole page. A container that was empty
 * (first load, or the other view) reserves nothing.
 */
export function showLoading(into) {
    var el = $(into);
    if (!el) return;
    lockHeight(el);
    el.innerHTML = '<div class="list-status list-status-loading" role="status" aria-live="polite">' +
        '<span class="list-status-spinner" aria-hidden="true"></span>' +
        '<span>' + escapeHtmlText(returnLang('loading')) + '</span></div>';
}

/**
 * Replace a view container with the empty state.
 *
 * The height reserved by showLoading() stays in place. It is released only by
 * renderInChunks() once real rows exist: an empty result is exactly the frame
 * this reservation exists for, and clearing it here would put the collapse
 * back on the paths that end in "no results" (clearing a search, switching to
 * a day with no visits).
 */
export function showNoResults(into) {
    var el = $(into);
    if (!el) return;
    el.innerHTML = '<div class="list-status no-results" role="status"><span>' +
        escapeHtmlText(returnLang('noResults')) + '</span></div>';
}
