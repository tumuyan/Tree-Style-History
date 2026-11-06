// Behaviour tests for the shared sort/group toolbar.
//
// history.js and bookmark.js used to carry the same three click handlers
// verbatim. This file drives the shared module the way a page does: seed the
// ids the real HTML provides, install stubs, then click each button.
//
// Each test gets a fresh DOM: `initSortBar()` binds once per element, and a
// second call in the same document would (correctly) refuse to stack handlers.
//
// The view detector is a *parameter*, not something the toolbar imports: the
// two pages read it differently (history.js reads inline `style.display`,
// bookmark.js falls back to computed style), so each test supplies its own,
// exactly like the page does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installStubs, importModule } from './stubs.mjs';
import { createDom } from './dom.mjs';

installStubs();

const { initSortBar } = await importModule('modules/sort-bar.js');

const IDS = [
    'rh-bar-group', 'rh-bar-orderby', 'rh-bar-order',
    'rh-views-insert', 'rh-views-search-insert', 'rh-search',
];

/** history-core.js's getActiveHistory(): inline `style.display` only. */
function activeFromInline(dom) {
    return () => {
        if (dom.el('rh-views-insert').style.display === 'block') return 'history';
        if (dom.el('rh-views-search-insert').style.display === 'block') return 'search';
        return undefined;
    };
}

/** bookmark.js's getActiveBookmark(): `getStyle()` falls back to computed style. */
function activeFromComputed(dom, computed = {}) {
    return () => {
        const display = (id) => dom.el(id).style.display || (computed[id] ?? '');
        if (display('rh-views-insert') === 'block') return 'history';
        if (display('rh-views-search-insert') === 'block') return 'search';
        return undefined;
    };
}

/**
 * A fresh document, clean storage, a recording refresh fn and a page-supplied
 * view detector. `display: 'initial'` reproduces the raw shipped state: the two
 * containers have NO inline style, and history.css gives them
 * `display: inline` / `display: none` respectively.
 */
function setup(initial = {}, { getActive, display = 'block' } = {}) {
    const dom = createDom();
    for (const id of IDS) dom.el(id);
    for (const key of ['rh-group', 'rh-orderby', 'rh-order']) delete localStorage[key];
    Object.assign(localStorage, initial);
    if (display === 'initial') {
        dom.el('rh-views-insert').style.display = '';
        dom.el('rh-views-search-insert').style.display = '';
    } else {
        dom.el('rh-views-insert').style.display = 'block';
        dom.el('rh-views-search-insert').style.display = 'none';
    }
    dom.el('rh-search').value = '';
    const calls = [];
    const detect = getActive || activeFromInline(dom);
    initSortBar((w, q) => calls.push([w, q]), detect);
    return {
        state: (id) => dom.el(id).getAttribute('data-state'),
        attr: (id, name) => dom.el(id).getAttribute(name),
        title: (id) => dom.el(id).title,
        el: (id) => dom.el(id),
        click: (id) => dom.el(id).dispatch('click'),
        calls,
        dom,
    };
}

test('the three buttons paint their stored state as data-state, not inline styles', () => {
    const t = setup({ 'rh-group': 'no', 'rh-orderby': 'title', 'rh-order': 'asc' });

    assert.equal(t.state('rh-bar-group'), 'no');
    assert.equal(t.state('rh-bar-orderby'), 'title');
    assert.equal(t.state('rh-bar-order'), 'asc');
    // The whole point of the refactor: no JS-written backgroundPosition.
    for (const id of ['rh-bar-group', 'rh-bar-orderby', 'rh-bar-order']) {
        assert.equal(t.el(id).style.backgroundPosition, undefined, `${id} still flips its icon in JS`);
    }
});

test('each button toggles its own key and leaves the other two alone', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });

    t.click('rh-bar-group');
    assert.equal(localStorage['rh-group'], 'no');
    assert.equal(localStorage['rh-orderby'], 'date');
    assert.equal(localStorage['rh-order'], 'desc');
    assert.equal(t.state('rh-bar-group'), 'no', 'the painted state follows the key');

    t.click('rh-bar-orderby');
    assert.equal(localStorage['rh-group'], 'no');
    assert.equal(localStorage['rh-orderby'], 'title');
    assert.equal(t.state('rh-bar-orderby'), 'title');

    t.click('rh-bar-order');
    assert.equal(localStorage['rh-order'], 'asc');
    assert.equal(t.state('rh-bar-order'), 'asc');
});

test('a toggle round-trips back to the original value', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });
    t.click('rh-bar-group');
    t.click('rh-bar-group');
    assert.equal(localStorage['rh-group'], 'yes');
    assert.equal(t.state('rh-bar-group'), 'yes');
});

test('a cold-start undefined still lands on a known state on the first click', () => {
    const t = setup({});
    t.click('rh-bar-group');
    assert.equal(localStorage['rh-group'], 'no');
    t.click('rh-bar-orderby');
    assert.equal(localStorage['rh-orderby'], 'title');
    t.click('rh-bar-order');
    assert.equal(localStorage['rh-order'], 'asc');
});

test('a click refreshes the active view with the page render function', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });
    t.click('rh-bar-group');
    assert.deepEqual(t.calls.at(-1), ['yes', ''], 'the history view is re-rendered');
});

test('the toolbar uses the getActive the page passes, not one it imports', () => {
    // Mutation guard for the review fix: sort-bar.js used to import
    // `getActiveHistory` from history-core.js and call it for BOTH pages. Feed a
    // detector claiming 'search' while the inline style still says the history
    // view is showing. Ignore the parameter and the query is never forwarded.
    const t = setup(
        { 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' },
        { getActive: () => 'search' },
    );
    t.el('rh-search').value = 'docs';
    t.click('rh-bar-orderby');
    assert.deepEqual(t.calls.at(-1), ['search', 'docs'],
        'the toolbar did not honour the page-supplied view detector');
});

test('a click on the initial CSS state re-renders the full view', () => {
    // The review asked for a case that does NOT pre-seed `style.display`. This
    // is the exact shipped state: no inline style, and history.css gives the
    // containers `display: inline` / `display: none`. Both detectors therefore
    // answer undefined — getActiveHistory() sees no inline style, and
    // getActiveBookmark() sees 'inline' instead of 'block'. The old code skipped
    // both branches and left the list untouched; refreshActive() now falls back
    // to the full view. Mutation: restore the two-branch if/else and this goes
    // red, on EITHER detector.
    for (const detect of [activeFromInline, activeFromComputed]) {
        const dom = createDom();
        for (const id of IDS) dom.el(id);
        for (const key of ['rh-group', 'rh-orderby', 'rh-order']) delete localStorage[key];
        dom.el('rh-views-insert').style.display = '';
        dom.el('rh-views-search-insert').style.display = '';
        dom.el('rh-search').value = '';
        const calls = [];
        initSortBar((w, q) => calls.push([w, q]), detect(dom, {
            'rh-views-insert': 'inline',
            'rh-views-search-insert': 'none',
        }));
        dom.el('rh-bar-group').dispatch('click');
        assert.deepEqual(calls.at(-1), ['yes', ''],
            `${detect.name}: a click on the initial view did not re-render`);
    }
});

test('in search mode a click re-runs the search with the typed query', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });
    t.el('rh-views-insert').style.display = 'none';
    t.el('rh-views-search-insert').style.display = 'block';
    t.el('rh-search').value = 'docs';
    t.click('rh-bar-orderby');
    assert.deepEqual(t.calls.at(-1), ['search', 'docs']);
});

test('in search mode an empty query falls back to the full view', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });
    t.el('rh-views-insert').style.display = 'none';
    t.el('rh-views-search-insert').style.display = 'block';
    t.el('rh-search').value = '';
    t.click('rh-bar-order');
    assert.deepEqual(t.calls.at(-1), ['yes', '']);
});

test('hints come from i18n and describe the next orderby click', () => {
    const t = setup({ 'rh-orderby': 'date' });
    // The stub echoes the key, so this proves which key is asked for.
    assert.equal(t.title('rh-bar-orderby'), 'orderByTitle');
    assert.equal(t.attr('rh-bar-orderby', 'aria-label'), 'orderByTitle');
    assert.equal(t.attr('rh-bar-group', 'aria-label'), 'group');
    assert.equal(t.attr('rh-bar-order', 'aria-label'), 'order');

    t.click('rh-bar-orderby'); // -> title
    assert.equal(t.title('rh-bar-orderby'), 'orderByTime', 'the hint flips with the state');
    assert.equal(t.attr('rh-bar-orderby', 'aria-label'), 'orderByTime');
});

test('a second initSortBar() in one document does not stack handlers', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });
    // Same document, a second bootstrap: one click must still be one toggle.
    initSortBar(() => t.calls.push(['second', '']), activeFromInline(t.dom));
    t.el('rh-bar-group').dispatch('click');
    assert.equal(localStorage['rh-group'], 'no', 'two handlers toggled it twice');
    assert.equal(t.calls.length, 1, 'the refresh ran more than once');
});

test('the toolbar reads and writes through storageAdapter, not the proxy', () => {
    const t = setup({ 'rh-group': 'yes', 'rh-orderby': 'date', 'rh-order': 'desc' });
    const reads = [];
    const writes = [];
    const api = globalThis.storageAdapter;
    const realGet = api.getItem;
    const realSet = api.setItem;
    api.getItem = (k) => { reads.push(k); return realGet(k); };
    api.setItem = (k, v) => { writes.push([k, v]); return realSet(k, v); };
    try {
        t.click('rh-bar-group');
    } finally {
        api.getItem = realGet;
        api.setItem = realSet;
    }

    assert.ok(reads.includes('rh-group'), 'paint() must read via storageAdapter.getItem()');
    assert.deepEqual(writes, [['rh-group', 'no']], 'the toggle must write via storageAdapter.setItem()');
    assert.equal(localStorage['rh-group'], 'no', 'the write lands in the shared store');
});
