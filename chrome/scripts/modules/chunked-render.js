// Tree Style History - chunked list renderer
//
// history.html and bookmark.html each carried two near-identical render loops
// (grouped / ungrouped): a setInterval(..., 5) tick, a time budget, a shared
// cursor, and the same end-of-list housekeeping. Only the per-row markup and
// one page-specific line differed. This module owns the loop and the finish;
// the pages supply a draw(i) callback and, for history.html, an onFinish()
// that clears the selected row.
//
// The time budget is why the loop is chunked at all: one row per tick ran at
// the browser's ~4ms timer floor, so a 1000-row list took seconds. One tick
// now draws as many rows as fit in RENDER_BUDGET_MS while still yielding to
// paint.

import { $, $$ } from '../dom-helper.js';
import { RENDER_BUDGET_MS } from './ui-state.js';
import { alertLoadingHistory, toggleGroup } from './list-view.js';
import { unlockHeight } from './list-status.js';

/**
 * Render `items` in time-budgeted chunks, then do the shared end-of-list work.
 *
 * @param {Array} items - rows to draw, in display order
 * @param {object} opts
 * @param {Function} opts.draw - paint row `i`; called exactly once per item
 * @param {string} opts.into - container id, with or without a leading `#`
 * @param {Function} [opts.onFinish] - page-specific work once the list is done
 * @returns {*} the interval handle, so a later render can cancel this one
 */
export function renderInChunks(items, opts) {
    var cursor = 0;
    // The two pages spell the id differently (`#id` in bookmark.js's selection
    // sweeps, bare `id` in the render loops). Normalise once so the selector
    // below can never become `##id ...`, which querySelectorAll() rejects.
    var into = String(opts.into).replace(/^#/, '');
    var handle = setInterval(function () {
        var deadline = Date.now() + RENDER_BUDGET_MS;
        try {
            while (cursor < items.length && Date.now() < deadline) {
                opts.draw(cursor);
                cursor++;
            }
        } catch (err) {
            // A row that throws (a bad host in toggleGroup, a favicon node that
            // will not build) must not leave the interval alive: cursor did not
            // advance, so every later tick would redraw the same row and throw
            // again, stacking a second live loop on each re-render. Stop here
            // and mark the pass finished so the finally block runs once.
            clearInterval(handle);
            cursor = items.length;
            console.warn('renderInChunks(): a row failed to draw', err);
        } finally {
            // Cleanup is independent of whether draw() threw. It used to sit
            // after the loop, so one bad row skipped all of it: the select-all
            // box stayed checked, the master checkbox stayed disabled, the
            // first group never opened, and cancel() could no longer find
            // this handle.
            if (cursor >= items.length) {
                clearInterval(handle);
                // The rows are real now, so the height showLoading() reserved
                // for them is no longer needed — and keeping it would pin every
                // later render to the tallest list this container ever held.
                unlockHeight(into);
                alertLoadingHistory(true);
                var input = document.body.querySelector('#rh-bar-uione input');
                if (input) input.checked = false;
                if (opts.onFinish) opts.onFinish();
                var groups = $$('#' + into + ' div.group-title');
                if (groups.length > 0) toggleGroup(groups[0].getAttribute('title'));
                $('master-check-all').removeAttribute('disabled');
            }
        }
    }, 5);
    return handle;
}
