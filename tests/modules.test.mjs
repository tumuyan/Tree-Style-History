// Behaviour tests for the extension's ES modules.
//
// These run under Node with stubbed browser globals (see ./stubs.mjs) and use
// the built-in `node:test` runner — no test framework dependency.
//
// Convention used here:
//   * A normal `test()` asserts behaviour that is correct TODAY. It is a
//     regression guard: if it breaks, a change broke something.
//   * `test(name, { skip: reason }, fn)` documents a KNOWN DEFECT. The body
//     asserts the *desired* behaviour. Un-skip it as part of the fix; until
//     then it is tracked in TODO.md with the same reference.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installStubs, importModule, importModuleFresh } from './stubs.mjs';

const env = installStubs();

const helpers = await importModule('modules/helpers.js');
const config = await importModule('modules/config.js');

// ---------------------------------------------------------------------------
// Smoke: the module graph must stay importable.
// This is the cheapest possible guard against breaking an import while
// refactoring — a syntax error or a bad export fails here in milliseconds.
// ---------------------------------------------------------------------------

const EXPECTED_EXPORTS = {
    'dom-helper.js': ['$', '$$', 'createElement', 'emptyElement', 'getStyle'],
    'modules/helpers.js': [
        'TimeToStr', 'timeNow', 'formatDate', 'echoLang', 'returnLang', 'stripScripts',
        'title_fix', 'escapeHtmlAttr', 'truncate', 'calcSize', 'getUrlVars',
        'isBookmarkletUrl', 'extractBookmarkletCode', 'executeBookmarklet',
        'chromeURL', 'getVersion', 'getVersionType', 'get_host', 'getFaviconUrl',
        'getFaviconOnerror', 'setupFaviconElement',
    ],
    'modules/config.js': [
        'defaultValues', 'defaultConfig', 'loadOptions', 'saveOptions', 'downloadOptions',
        'loadSlider', 'loadOptionsLang', 'initSortable', 'previewItem', 'updateFilter',
        'filtUrl', 'addList', 'mergeList',
    ],
    'modules/calendar.js': ['calendar_storage2', 'isLeapYear', 'calendar', 'showCalendar', 'save_calendar_storage2'],
    'modules/popup-core.js': [
        'leftClick', 'rightClick', 'formatItem', 'popupSearch', 'recentHistory',
        'recentlyClosedTabs', 'recentBookmarks', 'mostVisited', 'showRecentTabs', 'pinned',
    ],
    'modules/history-core.js': [
        'history', 'toggleGroup', 'getActiveHistory', 'getMoreItems', 'resetColor',
        'selectHistoryItem', 'deleteHistoryItem', 'alertLoadingHistory',
    ],
};

// Exports that are data rather than callables.
const VALUE_EXPORTS = new Set(['defaultValues', 'calendar_storage2', 'flist', 'flist_r', 'site_r']);

for (const [file, names] of Object.entries(EXPECTED_EXPORTS)) {
    test(`module graph: ${file} imports and exports its public API`, async () => {
        const mod = await importModule(file);
        for (const name of names) {
            assert.notEqual(mod[name], undefined, `${file} is missing export ${name}`);
            if (!VALUE_EXPORTS.has(name)) {
                assert.equal(typeof mod[name], 'function', `${file} export ${name} is not callable`);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// helpers.js — pure functions
// ---------------------------------------------------------------------------

test('escapeHtmlAttr neutralises all five HTML-significant characters', () => {
    assert.equal(helpers.escapeHtmlAttr(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('escapeHtmlAttr is applied to attribute-injection payloads', () => {
    // The shape of the XSS described in TODO P0: a URL carrying a double quote
    // would otherwise terminate a double-quoted HTML attribute.
    const payload = 'https://x.test/?a="onmouseover="alert(1)';
    const escaped = helpers.escapeHtmlAttr(payload);
    assert.ok(!escaped.includes('"'), 'quotes must be encoded before interpolation into an attribute');
    assert.ok(!escaped.includes('onmouseover="'), 'the injected attribute must not survive');
});

test('escapeHtmlAttr tolerates null and undefined', () => {
    assert.equal(helpers.escapeHtmlAttr(undefined), '');
    assert.equal(helpers.escapeHtmlAttr(null), '');
});

test('get_host extracts the hostname and falls back to "#"', () => {
    assert.equal(helpers.get_host('https://a.b.example.com/x?y=1'), 'a.b.example.com');
    assert.equal(helpers.get_host('https://example.com:8080/p'), 'example.com');
    assert.equal(helpers.get_host('not a url'), '#');
});

test('title_fix drops script blocks and angle brackets', () => {
    // `<script>…</script>` is removed wholesale; stray < > and / are stripped.
    assert.equal(helpers.title_fix('<script>alert(1)</script>a/b'), 'ab');
    assert.equal(helpers.title_fix('<img src=x onerror=alert(1)>'), 'img src=x onerror=alert(1)');
});

test('isBookmarkletUrl recognises javascript: URLs', () => {
    assert.equal(helpers.isBookmarkletUrl('javascript:void(0)'), true);
    assert.equal(helpers.isBookmarkletUrl('  JavaScript:alert(1)'), true);
    assert.equal(helpers.isBookmarkletUrl('https://example.com'), false);
});

test('truncate caps long strings and leaves short ones alone', () => {
    assert.equal(helpers.truncate('abcdef', 0, 3), 'abc...');
    assert.equal(helpers.truncate('ab', 0, 3), 'ab');
});

test('calcSize formats byte sizes', () => {
    assert.equal(helpers.calcSize(512), '512 b');
    assert.equal(helpers.calcSize(2048), '2.00 kb');
    assert.equal(helpers.calcSize('nope'), '--');
});

test('getFaviconUrl maps special protocols to bundled icons', () => {
    env.store.set('favicon-service', 'duckduckgo');
    assert.equal(helpers.getFaviconUrl('javascript:alert(1)'), 'images/iconmonstr-script-6.svg');
    assert.equal(helpers.getFaviconUrl('chrome://settings'), 'images/Browser-icon-vector-03.svg');
    assert.equal(helpers.getFaviconUrl('file:///tmp/a'), 'images/iconmonstr-file-3.svg');
});

test('getFaviconUrl builds a DuckDuckGo URL for http(s)', () => {
    env.store.set('favicon-service', 'duckduckgo');
    assert.equal(
        helpers.getFaviconUrl('https://example.com/a/b?c=1'),
        'https://icons.duckduckgo.com/ip3/example.com.ico',
    );
});

// ---------------------------------------------------------------------------
// config.js — defaults and filtering
// ---------------------------------------------------------------------------

test('defaultConfig writes every default and stringifies values', () => {
    env.reset();
    config.defaultConfig(false);
    for (const [key, value] of Object.entries(config.defaultValues)) {
        assert.ok(env.store.has(key), `defaultConfig did not write ${key}`);
        assert.equal(env.store.get(key), String(value));
    }
});

test('defaultConfig(false) does not clobber an existing value', () => {
    env.reset();
    env.store.set('rh-itemsno', '42');
    config.defaultConfig(false);
    assert.equal(env.store.get('rh-itemsno'), '42');
});

test('defaultConfig(true) restores defaults', () => {
    env.reset();
    env.store.set('rh-itemsno', '42');
    config.defaultConfig(true);
    assert.equal(env.store.get('rh-itemsno'), String(config.defaultValues['rh-itemsno']));
});

test('filtUrl returns false when no domains are configured', () => {
    env.reset();
    env.store.set('rh-filtered', 'false');
    config.updateFilter();
    assert.equal(config.filtUrl('https://example.com/a'), false);
});

test('filtUrl filters a configured domain and leaves others alone', () => {
    env.reset();
    env.store.set('rh-filtered', 'example.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://example.com/a'), true);
    assert.equal(config.filtUrl('https://other.com/x'), false);
    assert.equal(config.filtUrl('https://notexample.com/x'), false);
});

test('filtUrl ignores unrelated domains mentioned in the query string', () => {
    env.reset();
    env.store.set('rh-filtered', 'example.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://other.com/redirect?to=example.com'), false);
});

// ---------------------------------------------------------------------------
// KNOWN DEFECTS — un-skip each one as part of its fix.
// ---------------------------------------------------------------------------

test('importing config.js must not write to storage before storage is ready',
    { skip: 'TODO.md P0 — top-level updateFilter() overwrites rh-filtered with "false"' },
    async () => {
        // ES modules are evaluated before storage-adapter.js finishes loading
        // chrome.storage.local, so at evaluation time every key reads as
        // undefined and updateFilter() persists the "empty" default, wiping the
        // user's saved filter list.
        env.reset();
        await importModuleFresh('modules/config.js');
        assert.deepEqual([...env.store.keys()], [], 'module evaluation must have no storage side effects');
    });

test('updateFilter must tolerate regex metacharacters in the domain list',
    { skip: 'TODO.md P0 — new RegExp() throws SyntaxError, e.g. for "a("' },
    () => {
        env.reset();
        env.store.set('rh-filtered', 'a(');
        assert.doesNotThrow(() => config.updateFilter());
    });

test('a configured domain also covers its www subdomain',
    { skip: 'TODO.md P1 — site_r only strips labels from hosts with 4+ labels' },
    () => {
        env.reset();
        env.store.set('rh-filtered', 'example.com|');
        config.updateFilter();
        assert.equal(config.filtUrl('https://www.example.com/a'), true);
    });
