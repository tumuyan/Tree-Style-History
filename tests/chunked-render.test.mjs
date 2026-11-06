// Behaviour tests for the shared chunked list renderer.
//
// The two linear pages each had two copies of this loop (grouped / ungrouped).
// renderInChunks() owns the cursor, the time budget and the end-of-list work;
// each page supplies only a draw(i) callback (plus onFinish() on history.html).
// These tests drive the loop on its own, so a regression in the shared
// scheduling is visible without going through a full page render.
//
// The loop is a real setInterval(..., 5): like the page-level tests, give it a
// few ticks to finish. The finish hooks are the real list-view.js helpers, so
// the fixtures seed the handful of DOM ids they touch. document.body's
// querySelector is stubbed because the DOM stand-in cannot answer the
// `#rh-bar-uione input` shape; what matters is that the renderer looks the
// input up and clears it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installStubs } from './stubs.mjs';
import { createDom } from './dom.mjs';

installStubs();
const dom = createDom();
const { renderInChunks } = await import('../chrome/scripts/modules/chunked-render.js');

/** Minimal opts. `into` is a bare id; the `#id` shape is covered separately. */
function opts(overrides = {}) {
    return {
        into: 'rh-views-insert',
        ...overrides,
    };
}

let selectAllInput;
const originalQuery = document.body.querySelector;
document.body.querySelector = function (selector) {
    if (selector === '#rh-bar-uione input') return selectAllInput;
    return originalQuery.call(this, selector);
};

/** Seed everything the shared finish touches, then return the select-all input. */
function freshInput(checked) {
    selectAllInput = { checked: checked };
    dom.el('master-check-all');
    // alertLoadingHistory(true) writes both nodes; without them the real
    // finish hook throws and the loop's catch masks the assertion.
    dom.el('alert-holder');
    dom.el('alert-holder-loading');
    return selectAllInput;
}

test('renderInChunks draws every item exactly once, in order', async () => {
    freshInput(false);
    const seen = [];
    const items = ['a', 'b', 'c', 'd', 'e'];
    renderInChunks(items, opts({ draw: (i) => seen.push(items[i]) }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(seen, items, 'each row must be painted once, in display order');
});

test('the shared finish enables the master checkbox and clears the select-all input', async () => {
    const input = freshInput(true);
    dom.el('master-check-all').setAttribute('disabled', 'disabled');

    renderInChunks([], opts({ draw: () => {} }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(input.checked, false, 'the select-all checkbox must be reset on finish');
    assert.ok(dom.el('master-check-all').getAttribute('disabled') == null,
        'the master checkbox must be enabled again');
    assert.equal(dom.el('alert-holder').style.display, 'none',
        'the loading indicator must be hidden on finish');
});

test('onFinish runs once, after the last draw', async () => {
    freshInput(false);
    const order = [];
    const items = ['x', 'y'];
    renderInChunks(items, opts({
        draw: (i) => order.push('draw:' + items[i]),
        onFinish: () => order.push('onFinish'),
    }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.deepEqual(order, ['draw:x', 'draw:y', 'onFinish'],
        'the page-specific finish hook runs once, after all rows');
});

test('the interval handle returned cancels a render still in progress', async () => {
    freshInput(false);
    const seen = [];
    const handle = renderInChunks(new Array(100000).fill(0), opts({ draw: (i) => seen.push(i) }));
    clearInterval(handle);
    const atCancel = seen.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(seen.length, atCancel, 'a cancelled render must not keep drawing');
});

// An `into` carrying a leading `#` used to build `##rh-views-insert ...`,
// which querySelectorAll() rejects with a SyntaxError. The group-opening path
// never ran in the earlier fixtures (no div.group-title was seeded), so the
// normalisation needs a test that actually reaches it.
test('an into with a leading # still opens the first group once', async () => {
    freshInput(false);
    const root = dom.el('rh-views-insert');
    root.style.display = 'block'; // getActiveHistory() -> 'history'
    const title = dom.makeEl('div');
    title.className = 'group-title';
    title.setAttribute('title', 'example.com');
    root.appendChild(title);
    const toggle = dom.makeEl('a');
    toggle.setAttribute('rel', 'example.com');
    root.appendChild(toggle);
    const holder = dom.makeEl('div');
    holder.setAttribute('rel', 'example.com');
    holder.style.display = 'none';
    root.appendChild(holder);

    // The real toggleGroup() does the lookup; watch the holder it opens.
    renderInChunks([1], opts({
        into: '#rh-views-insert',
        draw: () => {},
    }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(holder.style.display, 'block',
        'the first group must open even when into carries a leading #');
    assert.equal(toggle.getAttribute('data-expanded'), 'true');
});

// A draw() that throws must not leave the interval alive. The old code put
// clearInterval() + finish after the loop, so one bad row skipped all of it:
// the handle was never updated and every later tick redrew the same row.
test('a draw() that throws still clears the interval and runs the finish once', async () => {
    const input = freshInput(true);
    dom.el('master-check-all').setAttribute('disabled', 'disabled');

    let draws = 0;
    let finished = 0;
    const warn = console.warn;
    console.warn = () => {};
    let handle;
    try {
        handle = renderInChunks([1, 2, 3], opts({
            draw: () => { draws++; throw new Error('bad row'); },
            onFinish: () => { finished++; },
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
        // Escape hatch: a build without the catch stops neither the loop nor
        // the handle, so this test would hang instead of going red. Clearing
        // here is a no-op for the correct implementation.
        clearInterval(handle);
        console.warn = warn;
    }

    assert.equal(draws, 1, 'the loop must stop after the first failing row');
    assert.equal(finished, 1, 'the finish hook must run exactly once');
    assert.equal(input.checked, false, 'cleanup in finally must still reset select-all');
    assert.ok(dom.el('master-check-all').getAttribute('disabled') == null,
        'cleanup in finally must still enable the master checkbox');
});
