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

/**
 * Replace a view container with the loading state.
 *
 * `role="status"` + `aria-live="polite"` make a chunked render reachable by a
 * screen reader: the rows are appended over several setInterval ticks, so a
 * reader that only looked at the final DOM would miss the interim state.
 */
export function showLoading(into) {
    var el = $(into);
    if (!el) return;
    el.innerHTML = '<div class="list-status list-status-loading" role="status" aria-live="polite">' +
        '<span class="list-status-spinner" aria-hidden="true"></span>' +
        '<span>' + escapeHtmlText(returnLang('loading')) + '</span></div>';
}

/** Replace a view container with the empty state. */
export function showNoResults(into) {
    var el = $(into);
    if (!el) return;
    el.innerHTML = '<div class="list-status no-results" role="status"><span>' +
        escapeHtmlText(returnLang('noResults')) + '</span></div>';
}
