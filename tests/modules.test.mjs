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
        'escapeHtmlAttr', 'escapeHtmlText', 'truncate', 'calcSize', 'getUrlVars',
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
const VALUE_EXPORTS = new Set(['defaultValues', 'calendar_storage2', 'flist', 'flist_r']);

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

test('escapeHtmlText keeps slashes and quotes that belong to the title', () => {
    // title_fix() deleted '/' outright, so "Docs / API" rendered as "Docs  API".
    // Quotes belong to the title too, and in a text position they need no
    // escaping — escaping them rewrites what the user actually wrote.
    assert.equal(helpers.escapeHtmlText('FAQ / Help'), 'FAQ / Help');
    assert.equal(helpers.escapeHtmlText('He said "hi"'), 'He said "hi"');
});

test('escapeHtmlText neutralises markup without deleting it', () => {
    assert.equal(helpers.escapeHtmlText('<img src=x onerror=alert(1)>'),
        '&lt;img src=x onerror=alert(1)&gt;');
    // A <script> block is escaped like any other markup, not deleted: once '<'
    // is escaped it cannot run, and stripping it would only lose text the user
    // wrote — the habit that made title_fix() eat slashes.
    assert.equal(helpers.escapeHtmlText('<script>alert(1)</script>a/b'),
        '&lt;script&gt;alert(1)&lt;/script&gt;a/b');
});

test('escapeHtmlText escapes ampersands first, so one pass is enough', () => {
    // '&' has to go first: escaping it last would turn the '&' of an entity
    // this function just produced into '&amp;'.
    assert.equal(helpers.escapeHtmlText('a & b'), 'a &amp; b');
    // Hence applying it twice is visibly wrong rather than silently wrong. That
    // is deliberate: double escaping is the failure mode to catch, and it is
    // exactly how a title ended up displaying as a literal '&#34;' (bookmark.js).
    assert.equal(helpers.escapeHtmlText(helpers.escapeHtmlText('a & b')), 'a &amp;amp; b');
    assert.equal(helpers.escapeHtmlText('a &lt; b'), 'a &amp;lt; b');
});

test('escapeHtmlText tolerates a missing title', () => {
    // chrome.history hands back entries with no title at all, and the render
    // loops still interpolate the field.
    assert.equal(helpers.escapeHtmlText(undefined), '');
    assert.equal(helpers.escapeHtmlText(null), '');
});

test('formatItem shows a page title verbatim instead of executing it', async () => {
    // A page title is attacker-controlled, and formatItem() interpolates it as
    // text content. Escaping lives here now rather than upstream in
    // title_fix(), which deleted '<', '>' and '/' — so "Docs / API" lost its
    // slashes, and any attempt to escape again produced literal entities.
    const popupCore = await importModule('modules/popup-core.js');
    const title = 'Docs / API "v2" <b>x</b>';

    const html = popupCore.formatItem({
        url: 'https://example.test/p', title, time: '13:05', type: 'rh',
        favicon: 'https://example.test/favicon.ico',
    }).innerHTML;

    assert.doesNotMatch(html, /<b>x<\/b>/, 'the markup in the title became a real element');
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/, 'the markup must be shown, not run');
    assert.match(html, /Docs \/ API "v2"/, 'slashes and quotes belong to the title');
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

test('downloadOptions restores the values that saveOptions(true) uploaded', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);

        env.store.clear(); // simulate a fresh profile pulling the config back down
        config.downloadOptions();

        assert.equal(env.store.get('rh-itemsno'), '16');
        assert.equal(env.store.get('rh-historypage'), 'yes');
        assert.equal(env.store.get('favicon-service'), 'duckduckgo');
        assert.equal(env.store.get('favicon-service-fallback'), '', 'the sync layer stores key names with underscores');
        assert.equal(env.store.get('share-favicon-cache'), 'yes', 'every underscore is turned back into a dash, not just the first');
        assert.equal(env.store.get('filterlist0'), undefined, 'filterlist slices are storage buckets, not config keys');
        assert.equal(env.store.get('filterlist_slices'), undefined, 'so is the slice count');
    } finally {
        t.mock.timers.reset();
    }
});

test('no config key contains an underscore', () => {
    // The sync layer renames keys: saveOptions() replaces every '-' with '_' on
    // the way into chrome.storage.sync, and downloadOptions() replaces every '_'
    // back with '-'. Both are global replaces, so the round-trip is only
    // reversible while no key contains '_' — 'a-b' and 'a_b' would both upload
    // as 'a_b' and come back as 'a-b', silently colliding. The invariant is not
    // visible from either function alone, so it is asserted here.
    const offenders = Object.keys(config.defaultValues).filter((key) => key.includes('_'));
    assert.deepEqual(offenders, [], 'a key containing an underscore cannot survive the sync round-trip');
});

/**
 * Render `domains` as filter rows and upload them, the way the options page
 * does before the user switches browser.
 *
 * Seed the upload through saveOptions() rather than writing filterlistN keys
 * straight into env.syncStore: that is what let the original bug through — the
 * old test hand-wrote slices that the code never actually produced.
 */
async function uploadDomains(domains) {
    const table = dom.el('flist-table');
    table.innerHTML = '';
    for (const domain of domains) {
        const row = dom.makeEl('tr');
        row.innerHTML = `<td>${domain}</td>`;
        table.appendChild(row);
    }
    await config.saveOptions(true);
}

/** The domains currently rendered in the filter table, in order. */
function renderedDomains() {
    return dom.el('flist-table').children.map((row) => row.cells[0].textContent);
}

test('mergeList reads every slice the last upload wrote', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        // 250 domains -> three slices. The loop used to stop at a hard-coded
        // 11 and then at the first missing slice; neither has anything to do
        // with the number of slices the upload actually wrote.
        await uploadDomains(Array.from({ length: 250 }, (_, i) => `d${i}.com`));
        assert.equal(env.syncStore.get('filterlist_slices'), '3');

        dom.el('flist-table').innerHTML = '';
        await config.mergeList();

        assert.equal(renderedDomains().length, 250, 'every slice contributed its domains');
    } finally {
        t.mock.timers.reset();
    }
});

test('re-uploading a shorter filter list does not resurrect removed domains', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await uploadDomains(Array.from({ length: 150 }, (_, i) => `d${i}.com`));
        assert.equal(env.syncStore.get('filterlist_slices'), '2');

        await uploadDomains(['only.test']);
        assert.equal(env.syncStore.get('filterlist_slices'), '1');
        assert.equal(env.syncStore.get('filterlist1'), undefined, 'the stale slice was left behind');

        // The consequence that matters: a fresh profile pulling the list back
        // down must not get d100..d149 again.
        dom.el('flist-table').innerHTML = '';
        await config.mergeList();
        assert.deepEqual(renderedDomains(), ['only.test']);
    } finally {
        t.mock.timers.reset();
    }
});

test('mergeList ignores slices from an upload that predates the slice count', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        // What a pre-fix upload actually left in sync storage: every slice
        // holding the page-zoom value, and no count to check them against.
        env.syncStore.set('filterlist0', '100');
        env.syncStore.set('filterlist1', '100');

        await config.mergeList();

        assert.deepEqual(renderedDomains(), [], 'garbage slices must not become domains');
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
// Filter list: storage-readiness race and regex compilation.
// ---------------------------------------------------------------------------

test('importing config.js must not write to storage before storage is ready',
    async () => {
        // ES modules are evaluated before storage-adapter.js finishes loading
        // chrome.storage.local, so at evaluation time every key reads as
        // undefined. updateFilter() used to persist its "empty" default right
        // then, and that write raced the pending read — winning it destroyed
        // the user's saved filter list.
        env.reset();
        await importModuleFresh('modules/config.js');
        assert.deepEqual([...env.store.keys()], [], 'module evaluation must have no storage side effects');
    });

// These two use a fresh module instance: `filterLoaded` and `flist` are
// module-level state, so a shared instance would leak earlier tests' lists.
test('updateFilter leaves storage untouched when it has not been read yet', async () => {
    env.reset();
    const fresh = await importModuleFresh('modules/config.js');

    fresh.updateFilter(); // storage is empty, so every key reads as undefined
    assert.deepEqual([...env.store.keys()], [], 'must not write the "false" sentinel over an unread list');
    assert.equal(fresh.filtUrl('https://a.com/x'), false, 'nothing is filtered while storage is unread');

    // Once the cache fills in, the real list takes effect.
    env.store.set('rh-filtered', 'a.com|');
    fresh.updateFilter();
    assert.equal(fresh.filtUrl('https://a.com/x'), true);
});

test('config.js refreshes the filter when storage becomes ready', async () => {
    env.reset();
    const fresh = await importModuleFresh('modules/config.js');
    assert.ok(env.pendingReady() > 0, 'config.js must register an onStorageReady hook');

    // Populated between module evaluation and the ready callback — exactly the
    // window the old top-level updateFilter() used to clobber.
    env.store.set('rh-filtered', 'ready.test|');
    env.fireStorageReady();

    // Asserted on the exported list rather than via filtUrl(): filtUrl() has a
    // lazy retry of its own, so only flist proves the *hook* ran.
    assert.equal(fresh.flist, 'ready.test|');
    assert.equal(fresh.filtUrl('https://ready.test/x'), true);
    assert.equal(env.pendingReady(), 0);
});

test('updateFilter must tolerate regex metacharacters in the domain list', () => {
    env.reset();
    env.store.set('rh-filtered', 'a(');
    assert.doesNotThrow(() => config.updateFilter());
    // 'a(' is not a browsable domain, but it *is* what get_host() returns for
    // such a URL, so the entry legitimately matches it. What matters here is
    // that compiling the list no longer throws and nothing else is caught.
    assert.equal(config.filtUrl('https://a(/x'), true);
    assert.equal(config.filtUrl('https://other.test/x'), false);
});

test('updateFilter survives every regex metacharacter in a domain', () => {
    for (const bad of ['a(', 'a)', '[a', 'a]', 'a{1', 'a+', 'a*', 'a?', 'a\\', 'a|b', 'a$b', 'a^b', 'a.b']) {
        env.reset();
        env.store.set('rh-filtered', bad + '|');
        assert.doesNotThrow(() => config.updateFilter(), `metacharacter: ${bad}`);
    }
});

test('a metacharacter in one entry must not break its siblings', () => {
    env.reset();
    env.store.set('rh-filtered', 'a(|ok.test|');
    assert.doesNotThrow(() => config.updateFilter());
    assert.equal(config.filtUrl('https://ok.test/x'), true, 'the valid entry still filters');
    assert.equal(config.filtUrl('https://other.test/x'), false);
});

test('an empty domain list must not match every URL', () => {
    // 'a.com|' ends in '|', so interpolating the raw string produced a regex
    // with an empty alternative — which matches everything.
    env.reset();
    env.store.set('rh-filtered', '');
    config.updateFilter();
    assert.equal(config.filtUrl('https://anything.test/x'), false);

    env.store.set('rh-filtered', 'false');
    config.updateFilter();
    assert.equal(config.filtUrl('https://anything.test/x'), false);
});

test('a dot in a domain filters only that domain', () => {
    // '.' is a regex wildcard: 'a.com' unescaped would also match 'axcom'.
    env.reset();
    env.store.set('rh-filtered', 'a.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://a.com/x'), true);
    assert.equal(config.filtUrl('https://axcom/x'), false);
});

// ---------------------------------------------------------------------------
// KNOWN DEFECTS — un-skip each one as part of its fix.
// ---------------------------------------------------------------------------

test('a configured domain also covers its www subdomain', () => {
    env.reset();
    env.store.set('rh-filtered', 'example.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://www.example.com/a'), true);
    assert.equal(config.filtUrl('https://example.com/a'), true, 'the listed domain itself');
    assert.equal(config.filtUrl('https://other.test/a'), false);
});

test('filter entries match whole host labels, not substrings', () => {
    env.reset();
    env.store.set('rh-filtered', 'b.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://b.co/x'), false, 'shares the "b.co" prefix only');
    assert.equal(config.filtUrl('https://b.com/x'), true, 'the listed domain itself must still match');
    assert.equal(config.filtUrl('https://xb.com/x'), false, 'shares the "b.com" suffix only');
    assert.equal(config.filtUrl('https://www.b.com/x'), true, 'www is not a separate site for this purpose');
    assert.equal(config.filtUrl('https://m.b.com/x'), false, 'only www is stripped, not every leading label');

    env.store.set('rh-filtered', 'sub.example.com|');
    config.updateFilter();
    assert.equal(config.filtUrl('https://example.com/a'), false, 'the parent of a listed subdomain');
    assert.equal(config.filtUrl('https://sub.example.com/a'), true, 'the listed subdomain must still match');
});

test('timeNow never appends "undefined" when the time format is unset', () => {
    env.store.delete('rh-timeformat');
    assert.equal(helpers.timeNow(TS), '13:05');

    // Both supported formats keep working.
    env.store.set('rh-timeformat', '12');
    assert.equal(helpers.timeNow(TS), '01:05 PM');
    env.store.set('rh-timeformat', '24');
    assert.equal(helpers.timeNow(TS), '13:05');
});

test('TimeToStr never appends "undefined" when the time format is unset', () => {
    env.store.delete('rh-timeformat');
    env.store.set('rh-date', 'mm/dd/yyyy');
    assert.equal(helpers.TimeToStr(TS), '01/02/2024 13:05');

    env.store.set('rh-timeformat', '12');
    assert.equal(helpers.TimeToStr(TS), '01/02/2024 01:05 PM');
    env.store.set('rh-timeformat', '24');
    assert.equal(helpers.TimeToStr(TS), '01/02/2024 13:05');
});

test('addList strips every whitespace character from the input', () => {
    formDefaults();
    // A trailing space survives replace(' ', '') and then fails the URL test,
    // so the domain is rejected outright with an "invalid URL" alert — it is
    // not added dirty, it is not added at all.
    assert.equal(config.addList(' example.com '), true);
    assert.match(dom.el('flist-table').children[0].innerHTML, /title="example\.com"/);
    assert.equal(dom.el('flist-add-i').value, '', 'the input is cleared after a successful add');

    assert.equal(config.addList('\tother.test\n'), true);
    assert.equal(dom.el('flist-table').children.length, 2);
});

test('saveOptions tolerates an order list that is not exactly five blocks', (t) => {
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

test('saveOptions(true) uploads the domain list sliced into groups', async (t) => {
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
        await config.saveOptions(true);

        assert.equal(env.syncStore.get('filterlist0'), domains.slice(0, 100).map((d) => d + '|').join(''));
        assert.equal(env.syncStore.get('filterlist1'), domains.slice(100).map((d) => d + '|').join(''));
        assert.equal(env.syncStore.get('filterlist_slices'), '2', 'the slice count travels with the upload');
    } finally {
        t.mock.timers.reset();
    }
});

test('saveOptions(true) reports success after a successful upload', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);
        assert.equal(dom.el('saveUpload').value, 'saved');
    } finally {
        t.mock.timers.reset();
    }
});

test('saveOptions(true) still rebuilds the in-memory filter', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        // The upload path is asynchronous, so it is tempting to return early
        // from the sync branch. updateFilter() and the context-menu refresh
        // live after it and must run for a synced save too, or the filter the
        // page keeps using is the one from before the edit.
        await config.saveOptions(true);
        assert.equal(config.filtUrl('https://example.com/page'), false, 'an empty list filters nothing');

        config.addList('example.com');
        await config.saveOptions(true);
        assert.equal(config.filtUrl('https://example.com/page'), true, 'the filter was not rebuilt');
    } finally {
        t.mock.timers.reset();
    }
});

test('saveOptions(true) reports failure when a write is rejected', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    // chrome.storage reports quota failures out of band, through lastError.
    // The old counting-based check could never see one: it compared a callback
    // tally against a hard-coded 26 when there are 38 config keys.
    env.chrome.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM exceeded' };
    try {
        await config.saveOptions(true);
        assert.equal(dom.el('saveUpload').value, 'saveFail');
    } finally {
        delete env.chrome.runtime.lastError;
        t.mock.timers.reset();
    }
});

test('a non-empty blocklist renders on the options page without breaking it', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.store.set('mv-blocklist', 'https://a.test/|https://b.test/|');
    try {
        assert.doesNotThrow(() => config.loadOptions(false));

        // Reading the list must not have wiped it, and the rows must be there
        // for saveOptions() to read back (it derives the value from the DOM).
        assert.equal(env.store.get('mv-blocklist'), 'https://a.test/|https://b.test/|');
        const rows = dom.el('mvlist-table').children;
        assert.equal(rows.length, 2);
        assert.match(rows[0].innerHTML, /https:\/\/a\.test\//);
        assert.match(rows[1].innerHTML, /https:\/\/b\.test\//);
    } finally {
        t.mock.timers.reset();
    }
});

test('saveOptions must not wipe a non-empty most-visited blocklist', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.store.set('mv-blocklist', 'https://a.test/|');
    try {
        config.loadOptions(false);
        config.saveOptions(false);
        assert.equal(env.store.get('mv-blocklist'), 'https://a.test/|');
    } finally {
        t.mock.timers.reset();
    }
});

test('removing a blocklist row and saving restores that site to most visited', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.store.set('mv-blocklist', 'https://a.test/|https://b.test/|');
    try {
        config.loadOptions(false);

        // Click the X on the first row, exactly as the options page does.
        const rows = dom.el('mvlist-table').children;
        const removeId = /id="(link-\d+)"/.exec(rows[0].innerHTML)[1];
        dom.el(removeId).dispatch('click');
        assert.equal(dom.el('mvlist-table').children.length, 1, 'the row must be gone from the DOM');

        config.saveOptions(false);
        assert.equal(env.store.get('mv-blocklist'), 'https://b.test/|', 'only the removed site is restored');
    } finally {
        t.mock.timers.reset();
    }
});

test('emptying the blocklist writes the "false" sentinel, not an empty string', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.store.set('mv-blocklist', 'https://a.test/|');
    try {
        config.loadOptions(false);
        dom.el('mvlist-table').innerHTML = '';
        config.saveOptions(false);
        // mostVisited() and popup-core.js both compare against 'false'.
        assert.equal(env.store.get('mv-blocklist'), 'false');
    } finally {
        t.mock.timers.reset();
    }
});

// ---------------------------------------------------------------------------
// Attribute selectors built from browsing data
//
// The grouped render loops find their group rows with
// `[rel="' + CSS.escape(host) + '"]`, where the host comes from a visited URL.
// The static guard in static.test.mjs proves the call is *written*; these prove
// the escaped selector still *matches*, which is the assumption the whole thing
// rests on and is not obvious from the name: CSS.escape() produces an
// identifier escape (`example.com` -> `example\.com`), and it is being used
// inside a QUOTED attribute selector, where the browser applies string
// unescaping instead. Worth testing rather than assuming — and without a
// runtime test, dropping the escape is invisible: the page would simply never
// find its own groups again.
// ---------------------------------------------------------------------------

/**
 * The group scaffolding the render loop builds for one host: a title carrying
 * the `<a rel=host>` toggle, and the holder `<div rel=host>` the toggle opens.
 *
 * The real markup nests the `<a>` inside the title's innerHTML, and this shim
 * does not parse innerHTML into a tree, so both nodes are appended as flat
 * children of the view. Enough for the lookup under test to mean something.
 */
function seedGroup(into, host) {
    const root = dom.el(into);
    root.innerHTML = '';
    root.children.length = 0;
    root.style.display = 'block'; // so getActiveHistory() resolves to 'history'

    const toggle = dom.makeEl('a');
    toggle.setAttribute('rel', host);
    root.appendChild(toggle);

    const holder = dom.makeEl('div');
    holder.setAttribute('rel', host);
    holder.style.display = 'none';
    root.appendChild(holder);

    return { toggle, holder };
}

test('CSS.escape produces the escapes the browser undoes in a quoted selector', () => {
    // Pins the stub (Node has no CSS global) to the real algorithm — every
    // assertion below is only as good as this one.
    assert.equal(CSS.escape('example.com'), 'example\\.com');
    assert.equal(CSS.escape('ex"ample.com'), 'ex\\"ample\\.com');
    // A leading digit goes out as hex plus a terminating space, which is the
    // other form a reader has to understand.
    assert.equal(CSS.escape('2fa.example'), '\\32 fa\\.example');
});

test('toggleGroup opens a group whose host would break a naive selector', async () => {
    const historyCore = await importModule('modules/history-core.js');
    // A quote in the host closes the attribute selector early. Not a security
    // hole on its own — the damage is that querySelector() throws instead of
    // matching, which aborts the chunked render loop and leaves the page half
    // drawn. toggleGroup() logs and does nothing when the lookup throws, so a
    // group the user cannot open is the observable symptom.
    const host = 'ex"ample.com';
    const { holder } = seedGroup('rh-views-insert', host);

    historyCore.toggleGroup(host);

    assert.equal(holder.style.display, 'block', 'the group was not found, so it could never be opened');
});

test('the same lookup without CSS.escape is the failure being prevented', () => {
    const host = 'ex"ample.com';
    const root = seedGroup('rh-views-insert', host).toggle.parentNode;

    // Reproduces the browser: an attribute selector whose value carries an
    // unescaped quote is not a valid selector, so querySelector() throws.
    assert.throws(() => root.querySelector(`div[rel="${host}"]`), SyntaxError);
    // Escaped, the identical lookup finds the group.
    assert.equal(root.querySelector(`div[rel="${CSS.escape(host)}"]`).style.display, 'none');
});

test('every shape of host stays selectable once escaped', async () => {
    const historyCore = await importModule('modules/history-core.js');
    // One host per branch of CSS.escape(): a dot (identifier escape), a quote
    // and square brackets (an IPv6 literal host), a leading digit and a leading
    // dash-digit pair (hex escape plus terminator).
    const hosts = ['example.com', 'ex"ample.com', '[::1]', '2fa.example', '-2fa.example'];
    for (const host of hosts) {
        const { holder } = seedGroup('rh-views-insert', host);
        historyCore.toggleGroup(host);
        assert.equal(holder.style.display, 'block', `toggleGroup could not find ${JSON.stringify(host)}`);
    }
});

// ---------------------------------------------------------------------------
// Rows that vanish underneath the selection handlers
//
// A checkbox can outlive the row that contains it: deleteHistoryItem('selected')
// removes `div.item-holder` elements, and any repaint that then sweeps every
// `.chkbx` meets a row whose ancestor is already gone. closest() returns null
// there, so each `closest(...).style` write has to tolerate it — one throw
// aborts the whole selection update and leaves the list half repainted.
// ---------------------------------------------------------------------------

/**
 * Restore the given localStorage keys when the test finishes.
 *
 * `dom` and `localStorage` are shared by every test in this file, and the
 * fixtures below steer the code under test through storage keys. Without this,
 * any test appended after them silently inherits their settings.
 */
function restoreStorage(t, keys) {
    const saved = keys.map((key) => [key, localStorage[key]]);
    t.after(() => {
        for (const [key, value] of saved) {
            if (value === undefined) delete localStorage[key];
            else localStorage[key] = value;
        }
    });
}

/** A `.chkbx` in the history view with NO `div.item-holder` ancestor. */
function seedOrphanCheckbox(t, into = 'rh-views-insert') {
    const root = dom.el(into);
    root.style.display = 'block'; // so getActiveHistory() resolves to 'history'

    const input = dom.makeEl('input');
    input.className = 'chkbx';
    input.value = 'https://example.com/page';
    input.checked = true;
    // Attached to the view itself, so nothing above it matches
    // `div.item-holder` or `div.group-title` — the shape a delete leaves behind.
    root.appendChild(input);

    dom.register(`#${into} .chkbx`, [input]);
    dom.register(`#${into} .chkbx:checked`, [input]);
    dom.el('master-check-all');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'no'; // keep to the ungrouped branch
    return input;
}

test('selectHistoryItem survives a checkbox whose item-holder is already gone', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    const input = seedOrphanCheckbox(t);

    assert.equal(input.closest('div.item-holder'), null, 'the fixture must really be orphaned');
    assert.doesNotThrow(() => historyCore.selectHistoryItem(input, 'single'));
});

test('selectHistoryItem("all") survives rows that have already been removed', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    const input = seedOrphanCheckbox(t);
    const master = dom.el('master-check-all');
    master.value = 'false'; // -> the "select everything" branch

    assert.equal(input.closest('div.item-holder'), null);
    assert.doesNotThrow(() => historyCore.selectHistoryItem(master, 'all'));
    assert.equal(input.checked, true, 'the sweep still ran; it just had nothing to repaint');
});

// ---------------------------------------------------------------------------
// deleteHistoryItem('range')
//
// The range is parsed by position: `rh-date` names the fields ("yyyy/mm/dd")
// and the two inputs supply the values. That mapping is only sound while the
// inputs were actually written in that format.
// ---------------------------------------------------------------------------

/** Wire up the two date inputs `deleteHistoryItem('range')` reads. */
function seedRangeInputs(t, format, from, to) {
    restoreStorage(t, ['rh-date']);
    localStorage['rh-date'] = format;
    dom.el('alert-holder').style.display = 'none';
    dom.el('alert-holder-loading');
    const one = dom.el('delete-range-one');
    const two = dom.el('delete-range-two');
    one.value = from;
    two.value = to;
    return { one, two };
}

/** Run `fn` with a chrome.history that records any deleteRange() it is asked for. */
function captureDeleteRange(fn) {
    let captured = null;
    withChromeApi({ history: { deleteRange: (range) => { captured = range; } } }, () => fn());
    return captured;
}

test('deleteHistoryItem("range") deletes exactly the range the inputs describe', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    seedRangeInputs(t, 'yyyy/mm/dd', '2026/09/01', '2026/09/10');

    const deleted = captureDeleteRange(() => historyCore.deleteHistoryItem('range'));

    assert.ok(deleted, 'deleteRange() was never called');
    // Both ends are pinned to 23:59:59.999 of their day, and the start is
    // pulled back one more day so the first day is included in full.
    assert.equal(deleted.startTime, new Date(2026, 8, 1, 23, 59, 59, 999).getTime() - 86400000);
    assert.equal(deleted.endTime, new Date(2026, 8, 10, 23, 59, 59, 999).getTime());
});

test('deleteHistoryItem("range") does nothing before storage has loaded', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    // rh-date is undefined until the storage cache is filled: the old code went
    // straight to `df.split('/')` and threw.
    restoreStorage(t, ['rh-date']);
    delete localStorage['rh-date'];
    dom.el('alert-holder').style.display = 'none';

    // One call, two assertions: throwing is not acceptable, and neither is a
    // deleteRange() that quietly reaches the API.
    let deleted;
    assert.doesNotThrow(() => {
        deleted = captureDeleteRange(() => historyCore.deleteHistoryItem('range'));
    });
    assert.equal(deleted, null);
});

test('deleteHistoryItem("range") refuses a range parsed from the wrong field order', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    // rh-date says yyyy/mm/dd but the inputs were filled in as mm/dd/yyyy.
    // Mapping by position puts the day in the year slot, which lands in 1909 —
    // a range that starts there deletes the entire history.
    seedRangeInputs(t, 'yyyy/mm/dd', '09/01/2026', '09/10/2026');

    assert.equal(captureDeleteRange(() => historyCore.deleteHistoryItem('range')), null,
        'a malformed range must never reach deleteRange()');
});

// ---------------------------------------------------------------------------
// The chunked render loop
//
// history() draws through a setInterval that runs until every item is placed.
// It used to draw exactly one item per tick, and to look each item's group up
// with three querySelector() calls. Both were replaced (a time budget per tick,
// and a host -> group Map), and neither change is visible from the outside if
// it merely renders the same result — so the result has to be asserted.
// ---------------------------------------------------------------------------

test('history() renders every item into its own host group', async (t) => {
    const historyCore = await importModule('modules/history-core.js');

    restoreStorage(t, ['rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    localStorage['rh-group'] = 'yes';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    // Unusual hosts: earlier tests configure filtered domains, and a leftover
    // entry would silently drop items here.
    const into = dom.el('rh-views-insert');
    into.textContent = ''; // clears children, as assignining textContent does
    into.style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    dom.el('rh-search');
    dom.el('delete-range-one');
    dom.el('delete-range-two');
    dom.el('master-check-all');
    dom.el('calendar-total-value');
    dom.el('alert-holder').style.display = 'block';
    dom.el('alert-holder-loading');
    dom.setOptions('rh-what', ['current', 'all'], 'current');

    const now = new Date();
    const items = [
        { id: '1', url: 'https://alpha.test/1', title: 'A1', visitCount: 1, lastVisitTime: now.getTime() - 3600000 },
        { id: '2', url: 'https://alpha.test/2', title: 'A2', visitCount: 1, lastVisitTime: now.getTime() - 3500000 },
        { id: '3', url: 'https://beta.test/1', title: 'B1', visitCount: 1, lastVisitTime: now.getTime() - 3400000 },
    ];
    withChromeApi({ history: { search: (_q, cb) => cb(items) } }, () => {
        historyCore.history('current', '');
    });

    // The loop is a setInterval: give it a few ticks to finish.
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(dom.el('calendar-total-value').textContent, '3', 'every item counted');

    const kids = into.children;
    const titles = kids.filter((c) => c.className.includes('group-title'));
    const holders = kids.filter((c) => c.className.includes('group-holder'));
    assert.equal(titles.length, 2, 'one group title per host');
    assert.equal(holders.length, 2, 'one group holder per host');

    // The point of the change: items go into their host's holder rather than
    // being appended at the top level, and none of them are dropped.
    const placed = holders.reduce((n, h) => n + h.children.length, 0);
    assert.equal(placed, 3, 'every item landed inside a group holder');

    // Keyed by host, not by position: the list is drawn newest first, so which
    // group comes first depends on the data.
    const byHost = new Map(holders.map((h) => [h.getAttribute('rel'), h.children.length]));
    assert.equal(byHost.get('alpha.test'), 2, 'alpha.test holds its two items');
    assert.equal(byHost.get('beta.test'), 1, 'beta.test holds its one item');
});

test('getMoreItems survives a group checkbox that is not inside a group title', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    const input = seedOrphanCheckbox(t);
    // A group-title checkbox carries the HOST, not a URL: getMoreItems()
    // compares el.value against get_host() of every .chkbx value.
    input.value = 'example.com';
    input.checked = false; // -> the "deselect this host" branch

    assert.equal(input.closest('div.group-title'), null);
    assert.doesNotThrow(() => historyCore.getMoreItems(input));
});
