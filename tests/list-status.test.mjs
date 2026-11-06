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
const { showLoading, showNoResults } = await import('../chrome/scripts/modules/list-status.js');

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
