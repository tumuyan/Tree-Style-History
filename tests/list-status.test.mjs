// Behaviour tests for the shared loading / empty state of the two linear pages.
// The module only needs a container element and the i18n catalogue, so it can
// be imported statically once the browser stubs are in place.
//
// stubs.mjs echoes the i18n key back as its message (deterministic wiring
// assertions), so these tests assert the key reaches the catalogue and that
// the resulting string is escaped — not a hard-coded English sentence.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { installStubs } from './stubs.mjs';
import { createDom } from './dom.mjs';

installStubs();
const dom = createDom();
const { showLoading, showNoResults, unlockHeight } = await import('../chrome/scripts/modules/list-status.js');

test('showLoading renders the translated text inside an announced status', () => {
    const el = dom.el('rh-views-insert');
    showLoading('rh-views-insert');
    assert.match(el.innerHTML, /class="list-status list-status-loading"/, 'no loading component');
    assert.match(el.innerHTML, /role="status"/, 'the status is not announced');
    assert.match(el.innerHTML, /aria-live="polite"/, 'the loading state is not live');
    assert.match(el.innerHTML, /list-status-spinner/, 'the spinner is missing');
    assert.match(el.innerHTML, />loading</, 'the i18n key did not reach the catalogue');
    assert.doesNotMatch(el.innerHTML, /<script/i, 'the component injects markup, not code');
});

test('showNoResults renders the translated empty message', () => {
    const el = dom.el('rh-views-search-insert');
    showNoResults('rh-views-search-insert');
    assert.match(el.innerHTML, /class="list-status no-results"/, 'no empty component');
    assert.match(el.innerHTML, />noResults</, 'the i18n key did not reach the catalogue');
});

test('both messages go through escapeHtmlText before innerHTML', () => {
    // The component concatenates an HTML string. A future catalogue value with
    // `&` or `<` must not turn into markup; pin the two call sites rather than
    // trusting the current (safe) catalogue.
    const mod = fs.readFileSync(new URL('../chrome/scripts/modules/list-status.js', import.meta.url), 'utf8');
    assert.match(mod, /escapeHtmlText\(returnLang\('loading'\)\)/,
        'the loading text is interpolated raw');
    assert.match(mod, /escapeHtmlText\(returnLang\('noResults'\)\)/,
        'the empty text is interpolated raw');
});

test('an unknown container id is a no-op, not a throw', () => {
    assert.doesNotThrow(() => showLoading('no-such-container'));
    assert.doesNotThrow(() => showNoResults('no-such-container'));
});

// ---------------------------------------------------------------------------
// Height reservation: the anti-jitter half of this module
//
// A re-render clears the container and repaints it over several setInterval
// ticks. Clearing it collapsed the document to one screen, which removed the
// vertical scrollbar and snapped the view back to the top — measured in a real
// browser as clientWidth 985 -> 1000 (every element shifting 15px sideways and
// the page heading re-wrapping) plus scrollTop 750 -> 0. The loading state now
// holds the height the list already had, so the swap is a repaint. These cases
// pin that reservation and its release; the visual result is asserted in
// e2e/pages.spec.mjs, which can measure real layout.
// ---------------------------------------------------------------------------

/** A container whose measured height is `height` layout pixels. */
function containerWithHeight(id, height) {
    const el = dom.el(id);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height });
    return el;
}

test('showLoading reserves the height the list already occupied', () => {
    const el = containerWithHeight('rh-views-insert', 600);
    el.style.minHeight = '';
    showLoading('rh-views-insert');
    assert.equal(el.style.minHeight, '600px',
        'the container did not keep its height, so the document collapses under the spinner');
});

test('showLoading reserves nothing for a container that was empty', () => {
    // First load, or the other (hidden) view: there is no height to protect,
    // and a zero reservation would be a `min-height: 0px` write for nothing.
    const el = containerWithHeight('rh-views-search-insert', 0);
    el.style.minHeight = '';
    showLoading('rh-views-search-insert');
    assert.equal(el.style.minHeight, '', 'an empty container must not be pinned at 0px');
});

test('the reservation is divided by the page zoom', () => {
    // applyZoom() sets a percentage `zoom` on body. getBoundingClientRect()
    // reports the *scaled* height, so writing it back verbatim would reserve
    // 1/zoom times too much and the page would grow instead of holding still.
    const el = containerWithHeight('rh-views-insert', 450);
    el.style.minHeight = '';
    const realGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ zoom: '1.5' });
    try {
        showLoading('rh-views-insert');
    } finally {
        globalThis.getComputedStyle = realGetComputedStyle;
    }
    assert.equal(el.style.minHeight, '300px',
        'the reserved height must be in layout pixels, not device pixels');
});

test('the empty state keeps the reservation', () => {
    // "no results" is not a shortcut out of the reservation: it is exactly the
    // frame that used to collapse. Releasing here puts the shift back on every
    // path that ends in an empty result (clearing a search, a day with no
    // visits). Only renderInChunks() releases, once real rows exist.
    const el = containerWithHeight('rh-views-insert', 600);
    showLoading('rh-views-insert');
    assert.equal(el.style.minHeight, '600px');
    showNoResults('rh-views-insert');
    assert.equal(el.style.minHeight, '600px',
        'the empty state dropped the reservation, so clearing a search collapses the page again');
});

test('showLoading -> showNoResults -> showLoading still holds a height', () => {
    // The exact sequence from clearing a search back to the main view: the
    // empty state must not have thrown the reservation away, because the next
    // showLoading() reads the height of a container with only a status div in
    // it (and #rh-views-insert is display:inline by default, so there may be
    // almost nothing to measure).
    const el = containerWithHeight('rh-views-insert', 600);
    showLoading('rh-views-insert');
    showNoResults('rh-views-insert');
    // Simulate the next render: the container now measures only the status.
    containerWithHeight('rh-views-insert', 48);
    showLoading('rh-views-insert');
    assert.notEqual(el.style.minHeight, '',
        'the reservation was lost across an empty intermediate state');
    assert.ok(parseFloat(el.style.minHeight) >= 48,
        'the empty state left the container with no height to protect');
});

test('unlockHeight is a no-op for an unknown container', () => {
    assert.doesNotThrow(() => unlockHeight('no-such-container'));
});
