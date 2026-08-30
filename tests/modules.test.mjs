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
import { createDom, htmlIds } from './dom.mjs';

const env = installStubs();

// The DOM stand-in must be installed before any module is imported: it replaces
// the bare `document` stub from stubs.mjs (modules read `document` at call time,
// so installing it first only matters for import-time side effects).
const dom = createDom();
const OPTION_IDS = htmlIds('options.html');

const helpers = await importModule('modules/helpers.js');
const config = await importModule('modules/config.js');

// A timestamp with an unambiguous rendering: 2024-01-02 13:05:06 local time.
// Built from components (not an epoch) so it is timezone-independent.
const TS = new Date(2024, 0, 2, 13, 5, 6, 0).getTime();

/** Swap in a `chrome.*` namespace for the duration of `fn`. */
function withChromeApi(overrides, fn) {
    const saved = globalThis.chrome;
    globalThis.chrome = { ...saved, ...overrides, tabs: { ...saved.tabs, ...(overrides.tabs || {}) } };
    try {
        return fn();
    } finally {
        globalThis.chrome = saved;
    }
}

// ---------------------------------------------------------------------------
// Option-page form fixture
//
// `dom` is seeded with the ids that options.html really provides, so
// `dom.missing` stays empty as long as config.js only touches real elements.
// ---------------------------------------------------------------------------

/**
 * Rebuild the option form from scratch. Leaves localStorage untouched, so a
 * test can mutate stored values and then re-render the form around them.
 */
function resetForm() {
    dom.reset();
    dom.seedIds(OPTION_IDS);

    for (const id of ['rh-order', 'rct-order', 'mv-order', 'rb-order', 'rt-order']) {
        const li = dom.makeEl('li');
        li.id = id;
        dom.el('rhlistorder').appendChild(li);
    }

    dom.setOptions('rhhistorypage', ['yes', 'no'], 'yes');
    dom.setOptions('showPopup', ['yes', 'no'], 'yes');
    dom.setOptions('rhdate', ['mm/dd/yyyy', 'yyyy/mm/dd', 'dd/mm/yyyy'], 'mm/dd/yyyy');
    dom.setOptions('rhtime', ['24', '12'], '24');
    dom.setOptions('rhsearch', ['yes', 'no'], 'yes');
    dom.setOptions('rmpath', ['yes', 'no'], 'yes');
    dom.setOptions('contextmenu', ['yes', 'no'], 'yes');
    dom.setOptions('rhsshowurl', ['no', 'yes'], 'no');
    dom.setOptions('rhsshowsep', ['no', 'yes'], 'no');
    dom.setOptions('rhsshowext', ['no', 'yes'], 'no');
    dom.setOptions('lessItem', ['no', 'yes'], 'no');
    dom.setOptions('faviconService', ['chrome', 'google', 'duckduckgo'], 'duckduckgo');
    dom.setOptions('shareFaviconCache', ['yes', 'no'], 'yes');
    dom.setOptions('faviconServiceFallback', ['', 'google', 'duckduckgo'], '');
    dom.setOptions('rhclick', ['newtab', 'currenttab'], 'newtab');
    dom.setOptions('rmclick', ['default', 'currenttab'], 'default');

    dom.el('rhwidth').value = '275';
    dom.el('loadrange').value = '7';
    dom.el('loadrange2').value = '3';
    dom.el('loadrange3').value = '120';
    dom.el('loadrange4').value = '150';
    dom.el('rhitemsno').value = '16';
    dom.el('rctitemsno').value = '4';
    dom.el('rtitemsno').value = '6';
    dom.el('mvitemsno').value = '0';
    dom.el('rbitemsno').value = '3';
    dom.el('popupZoom').value = '100';
    dom.el('pageZoom').value = '100';

    return dom;
}

/** Rebuild the form AND reset storage to the shipped defaults. */
function formDefaults() {
    resetForm();

    // Every value saveOptions()/loadOptions() read must exist, mirroring what
    // defaultConfig() guarantees in the browser.
    env.reset();
    config.defaultConfig(false);

    return dom;
}

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

test('getFaviconUrl covers every service offered by the options page', () => {
    const cases = {
        chrome: 'chrome://favicon/https://example.com/a',
        google: 'https://www.google.com/s2/favicons?sz=64&domain_url=' + encodeURIComponent('https://example.com/'),
        duckduckgo: 'https://icons.duckduckgo.com/ip3/example.com.ico',
        favicon_im: 'https://favicon.im/example.com?throw-error-on-404=true',
        faviconkit: 'https://ico.faviconkit.net/favicon/example.com?sz=64',
        faviconsnap: 'https://faviconsnap.com/api/favicon?url=' + encodeURIComponent('https://example.com/') + '&size=64',
    };
    for (const [service, expected] of Object.entries(cases)) {
        env.store.set('favicon-service', service);
        assert.equal(helpers.getFaviconUrl('https://example.com/a'), expected, `service: ${service}`);
    }
});

test('getFaviconUrl resolves the host, not the page, and keeps subdomains', () => {
    env.store.set('favicon-service', 'duckduckgo');
    assert.equal(
        helpers.getFaviconUrl('https://a.b.example.com/x?y=1'),
        'https://icons.duckduckgo.com/ip3/a.b.example.com.ico',
    );
});

test('getFaviconUrl falls back for empty input and non-http protocols', () => {
    env.store.set('favicon-service', 'google');
    assert.equal(helpers.getFaviconUrl('ftp://example.com/a'), 'images/blank.png');
    assert.equal(helpers.getFaviconUrl(''), '');
    assert.equal(helpers.getFaviconUrl(undefined), '');
    assert.equal(helpers.getFaviconUrl(undefined, { fallback: 'images/x.png' }), 'images/x.png');
});

test('getFaviconOnerror stays silent unless a fallback service is configured', () => {
    env.store.delete('favicon-service-fallback');
    assert.equal(helpers.getFaviconOnerror('https://example.com/a'), '');

    env.store.set('favicon-service-fallback', 'google');
    assert.equal(
        helpers.getFaviconOnerror('https://example.com/a'),
        'https://www.google.com/s2/favicons?sz=64&domain_url=' + encodeURIComponent('https://example.com/'),
    );
});

/** A stand-in <img> that records handlers so tests can trigger load/error. */
function fakeImg() {
    return {
        src: '',
        naturalWidth: 32,
        naturalHeight: 32,
        handlers: {},
        addEventListener(type, fn) { this.handlers[type] = fn; },
    };
}

test('setupFaviconElement tries the fallback service once, then goes blank', () => {
    const img = fakeImg();
    helpers.setupFaviconElement(img, 'primary', 'fallback');
    assert.equal(img.src, 'primary');

    img.handlers.error.call(img);
    assert.equal(img.src, 'fallback', 'the first error must switch to the fallback service');

    img.handlers.error.call(img);
    assert.equal(img.src, 'images/blank.png', 'a second failure must not loop');
});

test('setupFaviconElement treats a 16x16 load as a failed Google lookup', () => {
    // Google answers a miss with HTTP 404 *and* a valid 16x16 placeholder image,
    // so the `error` event never fires and the size check is the only signal.
    const img = fakeImg();
    img.naturalWidth = 16;
    img.naturalHeight = 16;
    helpers.setupFaviconElement(img, 'primary', 'fallback');
    img.handlers.load.call(img);
    assert.equal(img.src, 'fallback');

    img.handlers.load.call(img);
    assert.equal(img.src, 'fallback', 'the size check must not re-run once it fired');
});

// ---------------------------------------------------------------------------
// helpers.js — bookmarklets
// ---------------------------------------------------------------------------

test('executeBookmarklet refuses non-javascript: URLs without touching tabs', () => {
    let queried = false;
    let failed = false;
    withChromeApi({
        tabs: {
            query(_q, cb) { queried = true; cb([{ id: 1 }]); },
        },
    }, () => {
        helpers.executeBookmarklet('https://example.com', { onFailure: () => { failed = true; } });
    });
    assert.equal(queried, false, 'a normal URL must not be injected anywhere');
    assert.equal(failed, true);
});

test('executeBookmarklet injects decoded code into the active tab (MV3)', () => {
    const calls = [];
    let succeeded = false;
    withChromeApi({
        tabs: { query(_q, cb) { cb([{ id: 7 }]); } },
        scripting: { executeScript(req, cb) { calls.push(req); cb([]); } },
    }, () => {
        helpers.executeBookmarklet('javascript:' + encodeURIComponent('alert(1)'), { onSuccess: () => { succeeded = true; } });
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].target, { tabId: 7 });
    assert.equal(calls[0].world, 'MAIN', 'bookmarklets need the page world, not the isolated one');
    assert.deepEqual(calls[0].args, ['alert(1)']);
    assert.equal(succeeded, true);
});

test('executeBookmarklet can inject the raw code when decoding is disabled', () => {
    const calls = [];
    withChromeApi({
        tabs: { query(_q, cb) { cb([{ id: 7 }]); } },
        scripting: { executeScript(req, cb) { calls.push(req); cb([]); } },
    }, () => {
        helpers.executeBookmarklet('javascript:alert%281%29', { decode: false });
    });
    assert.deepEqual(calls[0].args, ['alert%281%29']);
});

test('executeBookmarklet reports failure when there is no active tab', () => {
    let failed = false;
    withChromeApi({
        tabs: { query(_q, cb) { cb([]); } },
        scripting: { executeScript() { assert.fail('must not inject without a target'); } },
    }, () => {
        helpers.executeBookmarklet('javascript:alert(1)', { onFailure: () => { failed = true; } });
    });
    assert.equal(failed, true);
});

// ---------------------------------------------------------------------------
// helpers.js — time formatting
// ---------------------------------------------------------------------------

test('TimeToStr renders a 24h clock with the configured date pattern', () => {
    env.store.set('rh-timeformat', '24');
    env.store.set('rh-date', 'mm/dd/yyyy');
    assert.equal(helpers.TimeToStr(TS), '01/02/2024 13:05');
});

test('TimeToStr honours yyyy/mm/dd and the 12h clock', () => {
    env.store.set('rh-timeformat', '12');
    env.store.set('rh-date', 'yyyy/mm/dd');
    assert.equal(helpers.TimeToStr(TS), '2024/01/02 01:05 PM');
});

test('timeNow formats a bare clock without a date', () => {
    env.store.set('rh-timeformat', '24');
    assert.equal(helpers.timeNow(TS), '13:05');
    env.store.set('rh-timeformat', '12');
    assert.equal(helpers.timeNow(TS), '01:05 PM');
});

test('formatDate renders the configured pattern, with placeholders when unset', () => {
    env.store.set('rh-date', 'mm/dd/yyyy');
    assert.equal(helpers.formatDate(TS), '01/02/2024');
    assert.equal(helpers.formatDate(undefined), '--/--/----');
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

test('filtUrl matches hosts case-insensitively and ignores the port', () => {
    env.reset();
    env.store.set('rh-filtered', 'example.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://EXAMPLE.com/a'), true);
    assert.equal(config.filtUrl('https://example.com:8443/a'), true);
});

test('filtUrl filters several configured domains independently', () => {
    env.reset();
    env.store.set('rh-filtered', 'a.com|b.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://a.com/1'), true);
    assert.equal(config.filtUrl('https://b.com/2'), true);
    assert.equal(config.filtUrl('https://c.com/3'), false);
});

test('filtUrl short-circuits on empty or missing input', () => {
    env.reset();
    env.store.set('rh-filtered', 'example.com|');
    config.updateFilter();
    assert.equal(config.filtUrl(undefined), false);
    assert.equal(config.filtUrl(''), false);
});

// ---------------------------------------------------------------------------
// config.js — the options page round-trip
//
// These drive saveOptions()/loadOptions() against the DOM stand-in. They are the
// closest thing to "click save on the options page" that runs without a browser;
// every one of them also asserts that config.js never touches an element id that
// options.html does not define.
// ---------------------------------------------------------------------------

test('saveOptions persists every option-page field to localStorage', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    try {
        config.saveOptions(false);

        assert.equal(env.store.get('rh-itemsno'), '16');
        assert.equal(env.store.get('rh-historypage'), 'yes');
        assert.equal(env.store.get('rh-date'), 'mm/dd/yyyy');
        assert.equal(env.store.get('rh-timeformat'), '24');
        assert.equal(env.store.get('rh-width'), '275px', 'the width is stored with its unit');
        assert.equal(env.store.get('load-range'), '7');
        assert.equal(env.store.get('favicon-service'), 'duckduckgo');
        assert.equal(env.store.get('rh-list-order'), 'rh-order,rct-order,mv-order,rb-order,rt-order');
        assert.equal(env.store.get('rh-filtered'), 'false', 'an empty domain list is stored as the literal "false"');
        assert.deepEqual([...dom.missing], [], 'saveOptions must only touch ids that options.html defines');
    } finally {
        t.mock.timers.reset();
    }
});

test('saveOptions stores everything as a string', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    try {
        config.saveOptions(false);
        for (const [key, value] of env.store) {
            assert.equal(typeof value, 'string', `${key} was stored as ${typeof value}`);
        }
    } finally {
        t.mock.timers.reset();
    }
});

test('loadOptions back-fills the form from localStorage', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.store.set('rh-itemsno', '32');
    env.store.set('rh-historypage', 'no');
    env.store.set('rh-date', 'yyyy/mm/dd');
    env.store.set('rh-width', '400px');
    env.store.set('rh-list-order', 'rct-order,rh-order');
    try {
        config.loadOptions(false);

        assert.equal(dom.el('rhitemsno').value, '32');
        assert.equal(dom.el('rhwidth').value, 400, 'the px suffix is parsed back off');
        const rhdate = dom.el('rhdate');
        assert.equal(rhdate.options[rhdate.selectedIndex].value, 'yyyy/mm/dd');
        const historyPage = dom.el('rhhistorypage');
        assert.equal(historyPage.options[historyPage.selectedIndex].value, 'no');
        assert.deepEqual(
            dom.el('rhlistorder').children.map((c) => c.id),
            // defaultValues['rh-list-order'] is "rh-order,rct-order,rb-order,mv-order,rt-order",
            // so the three blocks the saved order omits come back in that order.
            ['rct-order', 'rh-order', 'rb-order', 'mv-order', 'rt-order'],
            'blocks missing from the saved order are appended in default order',
        );
    } finally {
        t.mock.timers.reset();
    }
});

test('a value survives a save/load round-trip unchanged', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    try {
        config.saveOptions(false);
        const saved = new Map(env.store);

        resetForm(); // rebuild the form from the values just saved
        config.loadOptions(false);
        config.saveOptions(false);

        for (const [key, value] of saved) {
            assert.equal(env.store.get(key), value, `${key} did not survive the round-trip`);
        }
    } finally {
        t.mock.timers.reset();
    }
});

test('downloadOptions restores the values that saveOptions(true) uploaded', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        config.saveOptions(true);

        env.store.clear(); // simulate a fresh profile pulling the config back down
        config.downloadOptions();

        assert.equal(env.store.get('rh-itemsno'), '16');
        assert.equal(env.store.get('rh-historypage'), 'yes');
        assert.equal(env.store.get('favicon-service'), 'duckduckgo');
        assert.equal(env.store.get('favicon-service-fallback'), '', 'the sync layer stores key names with underscores');
        assert.equal(env.store.get('filterlist0'), undefined, 'filterlist slices are storage buckets, not config keys');
    } finally {
        t.mock.timers.reset();
    }
});

// ---------------------------------------------------------------------------
// config.js — the filtered-domain list
// ---------------------------------------------------------------------------

test('addList appends a row for a new domain', () => {
    formDefaults();
    assert.equal(config.addList('example.com'), true);

    const rows = dom.el('flist-table').children;
    assert.equal(rows.length, 1);
    assert.match(rows[0].innerHTML, /<td><div title="example\.com">example\.com<\/div><\/td>/);
    assert.equal(dom.el('flist-add-i').value, '', 'the input is cleared after a successful add');
});

test('addList rejects an empty or placeholder domain', () => {
    formDefaults();
    assert.equal(config.addList('false'), false);
    assert.equal(config.addList(''), false);
    assert.equal(dom.el('flist-table').children.length, 0);
});

test('addList rejects a domain that is already listed', () => {
    formDefaults();
    assert.equal(config.addList('example.com'), true);
    assert.equal(config.addList('example.com'), false);
    assert.equal(dom.el('flist-table').children.length, 1);
});

test('filteredDomainsList renders one row per configured domain', () => {
    formDefaults();
    env.store.set('rh-filtered', 'a.com|b.com|');
    dom.el('flist-table').innerHTML = '';
    config.filteredDomainsList();
    assert.equal(dom.el('flist-table').children.length, 2);
});

test('saveOptions uploads the rendered domain rows as the filter list', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    config.addList('a.com');
    config.addList('b.com');
    try {
        config.saveOptions(false);
        assert.equal(env.store.get('rh-filtered'), 'a.com|b.com|');
        assert.equal(config.filtUrl('https://a.com/x'), true, 'the saved list must take effect immediately');
    } finally {
        t.mock.timers.reset();
    }
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

test('filter entries match whole host labels, not substrings',
    { skip: 'TODO.md P1 — filtUrl 用 flist.indexOf(site) 做子串匹配，且正则含空分支' },
    () => {
        env.reset();
        env.store.set('rh-filtered', 'b.com|');
        config.updateFilter();
        assert.equal(config.filtUrl('https://b.co/x'), false, 'shares the "b.co" prefix only');

        env.store.set('rh-filtered', 'sub.example.com|');
        config.updateFilter();
        assert.equal(config.filtUrl('https://example.com/a'), false, 'the parent of a listed subdomain');
    });

test('title_fix keeps slashes that belong to the page title',
    { skip: 'TODO.md P1 — helpers.js:125 用 replace(/\\//g, "") 删除了所有斜杠' },
    () => {
        assert.equal(helpers.title_fix('FAQ / Help'), 'FAQ / Help');
    });

test('timeNow never appends "undefined" when the time format is unset',
    { skip: 'TODO.md P2 — helpers.js:74 var te 未初始化，rh-timeformat 既非 12 也非 24 时输出 "13:05undefined"' },
    () => {
        env.store.delete('rh-timeformat');
        assert.equal(helpers.timeNow(TS), '13:05');
    });

test('TimeToStr never appends "undefined" when the time format is unset',
    { skip: 'TODO.md P2 — helpers.js:23 var te 未初始化（与 timeNow 同源）' },
    () => {
        env.store.delete('rh-timeformat');
        env.store.set('rh-date', 'mm/dd/yyyy');
        assert.equal(helpers.TimeToStr(TS), '01/02/2024 13:05');
    });

test('addList strips every whitespace character from the input',
    { skip: 'TODO.md P1 — config.js:596 用 replace(" ", "") 只替换第一个空格' },
    () => {
        formDefaults();
        // A trailing space survives replace(' ', '') and fails the URL test, so
        // the domain is rejected outright with an "invalid URL" alert.
        assert.equal(config.addList(' example.com '), true);
        assert.match(dom.el('flist-table').children[0].innerHTML, /title="example\.com"/);
    });

test('saveOptions tolerates an order list that is not exactly five blocks',
    { skip: 'TODO.md P1 — config.js:433 硬编码 rhlo[0]..rhlo[4]' },
    (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        formDefaults();
        dom.el('rhlistorder').innerHTML = '';
        for (const id of ['rh-order', 'rct-order']) {
            const li = dom.makeEl('li');
            li.id = id;
            dom.el('rhlistorder').appendChild(li);
        }
        try {
            assert.doesNotThrow(() => config.saveOptions(false));
            assert.equal(env.store.get('rh-list-order'), 'rh-order,rct-order');
        } finally {
            t.mock.timers.reset();
        }
    });

test('saveOptions(true) uploads the domain list sliced into groups',
    { skip: 'TODO.md P1 — config.js:481-488 写入 so[i]（残留变量）且 item 从不自增' },
    (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        formDefaults();
        env.syncStore.clear();
        try {
            const domains = Array.from({ length: 150 }, (_, i) => `d${i}.com`);
            for (const domain of domains) {
                const row = dom.makeEl('tr');
                row.innerHTML = `<td>${domain}</td>`;
                dom.el('flist-table').appendChild(row);
            }
            config.saveOptions(true);

            assert.equal(env.syncStore.get('filterlist0'), domains.slice(0, 100).map((d) => d + '|').join(''));
            assert.equal(env.syncStore.get('filterlist1'), domains.slice(100).map((d) => d + '|').join(''));
        } finally {
            t.mock.timers.reset();
        }
    });

test('saveOptions(true) reports success after a successful upload',
    { skip: 'TODO.md P1 — config.js:492 硬编码 c - mls.length == 26' },
    (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        formDefaults();
        env.syncStore.clear();
        try {
            config.saveOptions(true);
            t.mock.timers.tick(1500);
            assert.equal(dom.el('saveUpload').value, 'saved');
        } finally {
            t.mock.timers.reset();
        }
    });

test('a non-empty most-visited blocklist must not break the options page',
    { skip: 'TODO.md P1 — options.html 缺少 #mvlist-table，mostVisitedBlocklist() 抛 TypeError' },
    (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        formDefaults();
        env.store.set('mv-blocklist', 'blocked.test|');
        try {
            assert.doesNotThrow(() => config.loadOptions(false));
        } finally {
            t.mock.timers.reset();
        }
    });

test('saveOptions must not wipe a non-empty most-visited blocklist',
    { skip: 'TODO.md P1 — options.html 缺少 #mvlist，saveOptions 读不到行，mlil 恒为 "false"' },
    (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        formDefaults();
        env.store.set('mv-blocklist', 'blocked.test|');
        try {
            config.saveOptions(false);
            assert.equal(env.store.get('mv-blocklist'), 'blocked.test|');
        } finally {
            t.mock.timers.reset();
        }
    });
