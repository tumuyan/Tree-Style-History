// Behaviour tests for the extension's ES modules.
//
// These run under Node with stubbed browser globals (see ./stubs.mjs) and use
// the built-in `node:test` runner — no test framework dependency.
//
// Convention used here:
//   * A normal `test()` asserts behaviour that is correct TODAY. It is a
//     regression guard: if it breaks, a change broke something.
//   * `test(name, { skip: reason }, fn)` documents a KNOWN DEFECT. The body
//     asserts the *desired* behaviour. Un-skip it as part of the fix.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

/**
 * Swap in a `chrome.*` namespace for the duration of `fn`.
 *
 * `fn` may be async. The swap has to outlive it in that case: a `finally`
 * around `return fn()` restores `chrome` while the promise is still pending, so
 * every continuation — which is where a stubbed callback actually resolves —
 * runs against the *original* namespace and silently gets the default stub.
 */
function withChromeApi(overrides, fn) {
    const saved = globalThis.chrome;
    globalThis.chrome = { ...saved, ...overrides, tabs: { ...saved.tabs, ...(overrides.tabs || {}) } };

    let result;
    try {
        result = fn();
    } catch (error) {
        globalThis.chrome = saved;
        throw error;
    }

    // A synchronous fn is the common case, and its effects must be observable
    // to the assertions that follow the call — so only wait on a promise.
    if (result && typeof result.then === 'function') {
        return result.finally(() => { globalThis.chrome = saved; });
    }
    globalThis.chrome = saved;
    return result;
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
    'dom-helper.js': ['$', '$$', 'createElement', 'getStyle'],
    'modules/helpers.js': [
        'TimeToStr', 'timeNow', 'formatDate', 'returnLang',
        'escapeHtmlAttr', 'escapeHtmlText', 'truncate', 'getUrlVars',
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
    'modules/calendar-colors.js': ['paintDay', 'paintSelectedDay'],
    'modules/popup-core.js': [
        'leftClick', 'rightClick', 'formatItem', 'popupSearch', 'recentHistory',
        'recentlyClosedTabs', 'recentBookmarks', 'mostVisited', 'showRecentTabs', 'pinned',
        'alertUser',
    ],
    'modules/history-core.js': [
        'history', 'toggleGroup', 'getActiveHistory', 'getMoreItems',
        'selectHistoryItem', 'deleteHistoryItem', 'alertLoadingHistory',
    ],
    'modules/tree.js': ['treeHtml', 'createTree', 'bindTreeSearch', 'collapseVisits'],
};

// Exports that are data rather than callables.
const VALUE_EXPORTS = new Set(['defaultValues', 'calendar_storage2']);

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
    // The shape of the historic URL-in-attribute XSS: a URL carrying a quote
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

test('the shared tooltip drops a URL that only repeats the title', () => {
    // This is the one behaviour the two copies actually disagreed on, and the
    // reason the merge is worth anything: the popup skipped a URL equal to the
    // title, bookmark.js pushed it, so a bookmark titled by its URL read the
    // same string twice in one tooltip. Nothing asserted it, which is how the
    // two comments describing the drift ended up saying opposite things.
    assert.equal(helpers.tooltipText('Docs', 'https://x.test/a', '12:00'),
        'Docs | https://x.test/a | 12:00');
    assert.equal(helpers.tooltipText('https://x.test/a', 'https://x.test/a', '12:00'),
        'https://x.test/a | 12:00');
    // `time` is optional: a most-visited row has none, and 'undefined' must not
    // be interpolated into the tooltip.
    assert.equal(helpers.tooltipText('Docs', 'https://x.test/a'), 'Docs | https://x.test/a');
    // A bookmarklet's URL is javascript:, too long and useless as a tooltip.
    assert.equal(helpers.tooltipText('Run it', 'javascript:void 0', '12:00'), 'Run it | 12:00');
    assert.equal(helpers.tooltipText('', 'javascript:void 0'), '[Bookmarklet]');
    assert.equal(helpers.tooltipText('', '', ''), '');
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

/** `fakeImg()` that also records every `src` assignment. */
function countingImg() {
    const img = fakeImg();
    img.writes = [];
    Object.defineProperty(img, 'src', {
        get() { return this._src; },
        set(v) { this._src = v; img.writes.push(v); },
    });
    return img;
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

// The favicon deadline. `helpers.js` keeps it private, so it is re-derived
// here from the source rather than exported just for the tests: the number
// itself is not what these assert, the "there is one and it fires" is.
const FAVICON_TIMEOUT = Number(
    /const FAVICON_TIMEOUT_MS = (\d+);/.exec(
        fs.readFileSync(new URL('../chrome/scripts/modules/helpers.js', import.meta.url), 'utf8'),
    )[1],
);

test('a favicon that never answers is given up on, so the page can finish loading', (t) => {
    // A favicon service that is blocked rather than broken — firewalled, or on
    // a network that blackholes the connection — never fires `error`: the
    // request just stays open. Measured on such a host, `readyState` stayed
    // `interactive` and `loadEventEnd` stayed 0 while the popup was plainly
    // usable, because Chrome sizes the popup on the `load` event.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const img = countingImg();
    try {
        helpers.setupFaviconElement(img, 'primary', 'fallback');
        assert.equal(img.src, 'primary', 'nothing has failed yet');

        t.mock.timers.tick(FAVICON_TIMEOUT + 1);
        assert.equal(img.src, 'fallback', 'the hang must end in the fallback service');

        // And the fallback can hang too — it is another remote request.
        t.mock.timers.tick(FAVICON_TIMEOUT + 1);
        assert.equal(img.src, 'images/blank.png', 'a second hang must end in the blank icon');

        // The blank icon is the end of the road: no further timer may be left
        // running against it, or it keeps firing into an image that is already
        // settled.
        img.writes.length = 0;
        t.mock.timers.tick(FAVICON_TIMEOUT * 3);
        assert.deepEqual(img.writes, [], 'nothing may fire after the blank icon');
    } finally {
        t.mock.timers.reset();
    }
});

test('a second real failure leaves no deadline behind it', (t) => {
    // Reached through `error`, not through the timer: the timer clears its own
    // handle before it calls `failed()`, so the blank branch's `settle()` is
    // only load-bearing when a *real* failure lands while the fallback's
    // deadline is still live. Without it that deadline fires on an image that
    // is already blank, and `failed()` runs again.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const img = countingImg();
    try {
        helpers.setupFaviconElement(img, 'primary', 'fallback');
        img.writes.length = 0;

        // The fallback service fails too, while its own deadline is pending.
        img.handlers.error.call(img);
        img.handlers.error.call(img);
        assert.deepEqual(img.writes, ['fallback', 'images/blank.png']);

        t.mock.timers.tick(FAVICON_TIMEOUT * 2);
        assert.deepEqual(img.writes, ['fallback', 'images/blank.png'],
            'nothing may fire once the icon is already blank');
    } finally {
        t.mock.timers.reset();
    }
});

test('a fallback that arrives keeps its icon', (t) => {
    // The `load` handler fires for the fallback too, and the `_checked` gate
    // was written for the size check — put the settle behind it and a
    // fallback that loads successfully is still swapped for the blank icon
    // when its own deadline expires, i.e. the one path that still has an icon
    // once the primary service is unreachable ends up with none.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const img = fakeImg();
    img.naturalWidth = 16;
    img.naturalHeight = 16;
    try {
        helpers.setupFaviconElement(img, 'primary', 'fallback');

        // The primary comes back as Google's 16x16 placeholder: a real
        // `load`, so the fallback is reached through the size check.
        img.handlers.load.call(img);
        assert.equal(img.src, 'fallback');

        // The fallback answers properly this time.
        img.naturalWidth = 32;
        img.naturalHeight = 32;
        img.handlers.load.call(img);
        t.mock.timers.tick(FAVICON_TIMEOUT * 2);
        assert.equal(img.src, 'fallback', 'a fallback that loaded must not be swapped out');
    } finally {
        t.mock.timers.reset();
    }
});

test('a favicon that answers ahead of the deadline keeps its icon', (t) => {
    // The deadline must not race a slow-but-working service: the icon lands
    // just inside its own deadline, and `load` settles the timer before it
    // can fire.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const img = fakeImg();
    try {
        helpers.setupFaviconElement(img, 'primary', 'fallback');
        t.mock.timers.tick(FAVICON_TIMEOUT - 1);
        img.handlers.load.call(img);
        t.mock.timers.tick(FAVICON_TIMEOUT * 2);
        assert.equal(img.src, 'primary', 'an icon that loaded must not be swapped out');
    } finally {
        t.mock.timers.reset();
    }
});

test('the deadline does not fire for an icon that already arrived', (t) => {
    // `load` settles the armed deadline on the way in. Without that settle, a
    // popup that renders icons from the Cache API — the common case, every
    // repeat visit — has every one of them swapped out for the fallback
    // service when its timer expires.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const img = fakeImg();
    try {
        helpers.setupFaviconElement(img, 'primary', 'fallback');
        // Finished almost immediately, from cache.
        img.handlers.load.call(img);
        t.mock.timers.tick(FAVICON_TIMEOUT * 3);
        assert.equal(img.src, 'primary', 'a cached icon must survive its own deadline');
    } finally {
        t.mock.timers.reset();
    }
});

test('a real favicon failure cancels the pending deadline', (t) => {
    // Otherwise a fast `error` and the timer both take the "first failure"
    // branch: two more `src` writes land where one should, and the icon races
    // straight past the fallback service to blank.
    //
    // Asserted by counting `src` writes, not by the final value: both the
    // correct and the buggy version end up on the blank icon, so the value
    // alone cannot tell them apart.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const img = countingImg();
    const writes = img.writes;
    try {
        helpers.setupFaviconElement(img, 'primary', 'fallback');

        // Fail partway through the primary's deadline. That is the shape that
        // distinguishes the two: the primary's timer is still pending when the
        // error lands, so a `settle()` that does not clear it leaves a second
        // deadline running — and it fires *earlier* than the fallback's own.
        t.mock.timers.tick(FAVICON_TIMEOUT / 2);
        img.handlers.error.call(img);
        assert.equal(img.src, 'fallback');
        writes.length = 0;

        // The primary's deadline would have expired by now. It must not fire:
        // the fallback has only been loading for half that time.
        t.mock.timers.tick(FAVICON_TIMEOUT / 2 + 1);
        assert.deepEqual(writes, [], 'the cancelled deadline must not fire');

        // The fallback's own deadline is what ends it, a full interval later.
        t.mock.timers.tick(FAVICON_TIMEOUT);
        assert.deepEqual(writes, ['images/blank.png'], 'the fallback still gets its own deadline');
    } finally {
        t.mock.timers.reset();
    }
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

test('loadOptions survives a cold profile the worker has not seeded yet', (t) => {
    // The options page runs its DOMContentLoaded handler as soon as
    // storageAdapter.ready() resolves, and `defaultConfig()` is the *worker's*
    // job. On a cold profile the two race: if the page wins, every key it reads
    // is `undefined`. `localStorage['rh-list-order'].split(',')` then threw, and
    // because that is the middle of the handler, everything after it was lost —
    // including the click listeners on 保存并上传 / 下载参数, which is why the
    // buttons looked dead. Reproduced in a real Chromium at roughly one cold
    // start in seven.
    //
    // Empty storage, no defaultConfig(): exactly the losing side of the race.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    resetForm();
    env.reset();
    try {
        assert.doesNotThrow(() => config.loadOptions(true), 'loadOptions threw on an unseeded profile');
        assert.doesNotThrow(() => config.mostVisitedBlocklist(), 'the most-visited blocklist threw on an unseeded profile');

        assert.deepEqual(
            dom.el('rhlistorder').children.map((c) => c.id),
            // defaultValues['rh-list-order'], in that order.
            ['rh-order', 'rct-order', 'rb-order', 'mv-order', 'rt-order'],
            'an unseeded profile must still draw the default block order',
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

test('downloadOptions only restores keys the extension still has a default for', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);

        // What an upgrade from 3.3.0 looks like: the cloud still carries the
        // three keys that were deleted from the defaults table, along with a
        // copy of a live key to prove the restore still works.
        env.syncStore.set('rh_time', 'yes');
        env.syncStore.set('rh_share', 'no');
        env.syncStore.set('rhs_showbg', 'yes');
        env.syncStore.set('rh_itemsno', '9');

        env.store.clear();
        config.downloadOptions();

        assert.equal(env.store.get('rh-itemsno'), '9', 'a live key is still restored');
        assert.equal(env.store.has('rh-time'), false, 'a key with no default is not restored');
        assert.equal(env.store.has('rh-share'), false);
        assert.equal(env.store.has('rhs-showbg'), false);
    } finally {
        t.mock.timers.reset();
    }
});

test('downloadOptions sweeps retired keys out of sync instead of leaving them behind', async (t) => {
    // Without the sweep the whitelist only hides the problem: the key stays in
    // the cloud and is skipped again on every subsequent restore. Nothing else
    // ever removes it — that is how the three keys outlived their readers.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);
        env.syncStore.set('rh_time', 'yes');
        env.syncStore.set('filterlist0', 'a.com|');
        env.syncStore.set('filterlist_slices', '1');

        const kept = new Map(env.syncStore);
        env.store.clear();
        config.downloadOptions();

        assert.equal(env.syncStore.has('rh_time'), false, 'the retired key is gone from chrome.storage.sync');
        assert.equal(env.syncStore.get('rh_itemsno'), kept.get('rh_itemsno'), 'live keys stay in the cloud');
        assert.equal(env.syncStore.get('filterlist0'), 'a.com|', 'filter slices are not config keys and must survive');
        assert.equal(env.syncStore.get('filterlist_slices'), '1');
    } finally {
        t.mock.timers.reset();
    }
});

test('downloadOptions drops a retired key that only exists locally', async (t) => {
    // The sync copy is not the only corpse: the version that wrote the key left
    // it in chrome.storage.local, and a restore that only swept the cloud would
    // keep showing it in devtools forever on a profile that never synced again.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);
        env.store.set('rh-share', 'yes');
        env.store.set('rh-pinned', 'false');

        config.downloadOptions();

        assert.equal(env.store.has('rh-share'), false, 'a local copy of a retired key is swept too');
        assert.equal(env.store.get('rh-pinned'), 'false', 'rh-pinned has a default, so it round-trips');
    } finally {
        t.mock.timers.reset();
    }
});

test('downloadOptions leaves the SW runtime state alone', async (t) => {
    // localStorage under this adapter is not the config file — it is the whole
    // of chrome.storage.local. Treating every key that is not a config key as a
    // retired one zeroed the heat map (calendar-storage2 is hydrated once, at
    // startup, so the page cannot put it back), threw away the crawl cursor
    // (calendar-storage), the closed-tab group ordinal (oid), the negative
    // favicon cache and the most-visited cache.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);

        const runtime = {
            'calendar-storage2': '{"1700000000000":7}',
            'calendar-storage': '{"cursor":1}',
            'oid': '4',
            'favicon-negative-cache': '{"https://x/favicon.ico":1700000000000}',
            'mv-cache': '[{"url":"a.com"}]',
        };
        for (const [key, value] of Object.entries(runtime)) env.store.set(key, value);

        config.downloadOptions();

        for (const [key, value] of Object.entries(runtime)) {
            assert.equal(env.store.get(key), value, `${key} is runtime state, not a retired config key`);
        }
    } finally {
        t.mock.timers.reset();
    }
});

test('the sweep names cloud keys the cloud itself spelled', async (t) => {
    // The two spellings have to be kept apart, so the keys handed to
    // chrome.storage.sync.remove() are asserted directly rather than inferred
    // from what the cloud looks like afterwards (a stub whose remove() is a
    // no-op makes that inference vacuous).
    //
    // Deriving the cloud name from the local one re-uploads a key: removing a
    // local `rh-share` is a write, chrome.storage.onChanged hands it to the SW,
    // and the SW's upload maps '-' to '_'. 'rh_share' is exactly the corpse
    // this change is meant to bury, so the sweep may only name the keys it
    // actually found in the cloud.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    const removed = [];
    let stop;
    try {
        await config.saveOptions(true);
        env.syncStore.set('rh_time', 'yes');
        // Local-only leftovers: no cloud copy exists to be removed.
        env.store.set('rh-share', 'yes');
        env.store.set('rh-width-old', '1px');

        stop = withChromeApi({
            storage: {
                ...globalThis.chrome.storage,
                sync: {
                    ...globalThis.chrome.storage.sync,
                    remove: (keys, cb) => {
                        removed.push(...(Array.isArray(keys) ? keys : [keys]));
                        if (cb) cb();
                        return Promise.resolve();
                    },
                },
            },
        }, () => config.downloadOptions());
        await stop;

        assert.deepEqual(removed, ['rh_time'], 'only the key the cloud carried is removed from the cloud');
        assert.equal(env.store.has('rh-share'), false, 'the local copy is swept all the same');
        assert.equal(env.store.has('rh-width-old'), false);
    } finally {
        t.mock.timers.reset();
    }
});

test('downloadOptions restores live keys however many dashes the cloud spelled away', async (t) => {
    // The whitelist is `defaultValues`, and the comparison must happen on the
    // local dash-spelled name — never on an underscored copy of the defaults
    // table. chrome.storage.sync holds what earlier versions uploaded, and
    // 3.3.0 and earlier used `replace('-', '_')`, which underscores only the
    // first dash. So a live key with two dashes lives in the cloud as
    // 'rh_list-order', not 'rh_list_order'. Judged against the underscored
    // spelling, every such key looked retired: its local value was deleted and
    // its cloud copy swept, resetting the setting on both sides.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);
        env.store.clear();

        // 'rh-list-order' arrives in the old (first-dash-only) spelling;
        // 'share-favicon-cache' and 'favicon-service-fallback' in the current
        // one. Both must survive, in either direction.
        env.syncStore.set('rh_list-order', 'rt,rh,rct,rcb,rb,mv');
        env.syncStore.set('share_favicon_cache', 'no');
        env.syncStore.set('favicon_service_fallback', 'duckduckgo');

        config.downloadOptions();

        assert.equal(env.store.get('rh-list-order'), 'rt,rh,rct,rcb,rb,mv',
            'a key whose cloud spelling lost only the first dash is still a live key');
        assert.equal(env.store.get('share-favicon-cache'), 'no');
        assert.equal(env.store.get('favicon-service-fallback'), 'duckduckgo');
        assert.equal(env.syncStore.get('rh_list-order'), 'rt,rh,rct,rcb,rb,mv',
            'the cloud copy of a live key is not swept either');
        assert.equal(env.syncStore.has('share_favicon_cache'), true);
        assert.equal(env.syncStore.has('favicon_service_fallback'), true);
    } finally {
        t.mock.timers.reset();
    }
});

test('the per-version install flag is not mistaken for a retired key', async (t) => {
    // popup.js writes 'rh-version-<version>' so the "installed" banner shows
    // once. It is not in `defaultValues` (the version is the key, so the table
    // cannot list them), yet it is not retired either — sweeping it re-arms the
    // banner on every restore. Asserted through the public entry point because
    // the carve-out lives in downloadOptions(), not in the table.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    formDefaults();
    env.syncStore.clear();
    try {
        await config.saveOptions(true);
        env.store.clear();
        env.store.set('rh-version-3.3.1', 'true');

        config.downloadOptions();

        assert.equal(env.store.get('rh-version-3.3.1'), 'true',
            'the install flag outlives a restore');
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

    // filtUrl() has a lazy retry of its own (it calls updateFilter() the first
    // time it runs), so a plain call would pass even if the hook never fired.
    // Removing the key first closes that door: a retry now reads `undefined`,
    // bails out and leaves the filter at its "false" sentinel, while a filter
    // the hook already loaded keeps working.
    env.store.delete('rh-filtered');
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
        const removeId = /id="(link-[^"]+)"/.exec(rows[0].innerHTML)[1];
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
// The colour a row returns to when it is unselected
//
// Selecting writes selectedColor inline; unselecting has to *remove* that
// write, so the row falls back to `div[rel="white"]` / `div[rel="grey"]` in
// history.css. Those two rules are redefined per theme (#fff/#fafafa in light,
// #555/#444 in dark), so writing any literal back is wrong in at least one of
// them — which is how "unselect all" used to leave a stripe no single uncheck
// ever reproduced.
// ---------------------------------------------------------------------------

/**
 * Swap in a DOM whose `querySelectorAll` understands the one descendant
 * selector the select/unselect sweeps use (`#view .chkbx`).
 *
 * The shared `tests/dom.mjs` shim answers that selector from a registry the
 * test pins by hand, which is fine for a single row and useless for a sweep
 * over several. This one just walks the subtree, so a fixture can append as
 * many rows as it likes and the sweep finds exactly them.
 *
 * The stand-in is restored when the test ends; `selectHistoryItem` reads the
 * ambient `document` at call time, so nothing is re-imported.
 */
function withRowDom(t, rows) {
    const saved = document;
    // `document` is not a snapshot: reading `saved.querySelectorAll` in the
    // restore hook would read whatever is installed *then* — which is the
    // walker installed below, so the hook would put the walker back. Hold the
    // function itself, before anything replaces it.
    const savedQuerySelectorAll = saved.querySelectorAll;
    const view = saved.getElementById('rh-views-insert');
    const restore = { children: view.children, display: view.style.display };
    view.children = [];
    view.style.display = 'block'; // getActiveHistory() -> 'history'

    const holders = [];
    for (const rel of rows) {
        const holder = saved.createElement('div');
        holder.className = 'item-holder';
        holder.setAttribute('rel', rel);
        const input = saved.createElement('input');
        input.className = 'chkbx';
        input.value = `https://example.com/${rel}`;
        holder.appendChild(input);
        view.appendChild(holder);
        holders.push({ holder, input });
    }

    // `#view .chkbx[:checked]` -> every checkbox under `view` (optionally only
    // the checked ones), depth-first at any depth.
    const collect = (root, checkedOnly) => {
        const out = [];
        const walk = (node) => {
            for (const child of node.children) {
                // `classes`, not `hasAttribute('class', 'chkbx')`: the shim's
                // `hasAttribute` takes one argument and silently drops the
                // second, so that spelling means "an <input> carrying any class
                // at all" — every input in the fixture. No case currently puts
                // a non-checkbox <input> inside the view, so the two spellings
                // cannot be told apart by the suite; the predicate is still the
                // one thing this sweep is supposed to ask.
                if (child.tagName === 'INPUT' && child.classes.has('chkbx')
                    && (!checkedOnly || child.checked)) out.push(child);
                walk(child);
            }
        };
        walk(root);
        return out;
    };
    // One selector is answered here: the checkbox sweep the assertions are
    // about. Everything else falls through to the shim, which answers selectors
    // it does not understand with [] — the same way it did before, so a test
    // cannot start relying on something the browser would answer differently.
    // The group-title lookup used to be answered here too, until both list
    // pages started resolving it by walking their container's `children` —
    // which needs no shim at all.
    document.querySelectorAll = (sel) => {
        const text = String(sel).trim();
        const m = /^#([\w-]+)\s+\.chkbx(:checked)?$/.exec(text);
        if (m) {
            const root = saved.getElementById(m[1]);
            return root ? collect(root, Boolean(m[2])) : [];
        }
        return savedQuerySelectorAll.call(document, sel);
    };

    t.after(() => {
        document.querySelectorAll = savedQuerySelectorAll;
        view.children = restore.children;
        view.style.display = restore.display;
    });

    return holders;
}

test('one uncheck puts the row back to the colour the stylesheet gives it', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'no';
    const [{ holder, input }] = withRowDom(t, ['grey']);
    document.getElementById('master-check-all');

    input.checked = true;
    historyCore.selectHistoryItem(input, 'single');
    assert.equal(holder.style.backgroundColor, '#ffcbd3', 'the fixture must start from a selected row');

    input.checked = false;
    historyCore.selectHistoryItem(input, 'single');

    assert.equal(holder.style.backgroundColor, '',
        'the row still carries an inline colour, so it cannot follow the theme');
});

/**
 * A grouped history row: `div.group-holder[rel=host]` wrapping the row, plus
 * the title above it carrying the same host in `title`. That pairing is the
 * render loop's, and it is how the unselect sweep finds the title.
 *
 * Requires `withRowDom()` first: the sweep resolves its rows through
 * `$$('#view .chkbx')`, and the shared shim answers that selector from an empty
 * registry — the rows would be invisible and every assertion here would pass or
 * fail for the wrong reason.
 */
let groupedRowSeq = 0;

function seedGroupedRow(rows, host) {
    const view = document.getElementById('rh-views-insert');
    const title = document.createElement('div');
    title.className = 'item-holder group-title';
    title.setAttribute('title', host);
    title.setAttribute('rel', 'white');

    view.appendChild(title);

    const holder = document.createElement('div');
    holder.className = 'group-holder';
    holder.setAttribute('rel', host);

    const built = [];
    for (const rel of rows) {
        const row = document.createElement('div');
        row.className = 'item-holder';
        row.setAttribute('rel', rel);
        const input = document.createElement('input');
        input.className = 'chkbx';
        // One URL per row: the single-click sweep unticks every checkbox that
        // shares a URL, so a shared value would make one click a bulk action.
        input.value = `https://${host}/${rel}/${++groupedRowSeq}`;
        row.appendChild(input);
        holder.appendChild(row);
        built.push({ holder: row, input });
    }
    view.appendChild(holder);
    return { title, rows: built };
}

test('select-all paints the group title rather than the rows inside it', async (t) => {
    // Same rule as the bookmarks page: a grouped row carries no inline colour
    // of its own, it shows the title's. Painting the row leaves one pink line
    // inside a group whose title still reads as unselected, and it also pins a
    // colour the row cannot drop when the theme changes.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'yes';
    withRowDom(t, ['grey']);
    const { title, rows } = seedGroupedRow(['grey'], 'group.test');
    const master = document.getElementById('master-check-all');
    master.value = 'false';

    historyCore.selectHistoryItem(master, 'all');

    assert.equal(title.style.backgroundColor, '#ffcbd3', 'the title is what shows the selection');
    for (const { holder } of rows) {
        assert.equal(holder.style.backgroundColor, '#ffcbd3',
            'select-all paints the row too; only the unselect sweep has to clear both');
    }
});

test('select-all then unselect-all leaves a group title and its rows uncoloured', async (t) => {
    // The sweep behind "select all" visits every row; the one behind "unselect
    // all" has to undo exactly what the first wrote, on the same element. When
    // the two disagree the title keeps its selection colour for good.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'yes';
    withRowDom(t, ['grey']);
    const { title } = seedGroupedRow(['grey'], 'group.test');
    const master = document.getElementById('master-check-all');

    master.value = 'false';
    historyCore.selectHistoryItem(master, 'all');
    assert.equal(title.style.backgroundColor, '#ffcbd3', 'the fixture must start selected');

    master.value = 'true';
    historyCore.selectHistoryItem(master, 'all');

    assert.equal(title.style.backgroundColor, '', 'the title kept its selection colour');
});

test('unselect-all clears the title of its own view, not the other one', async (t) => {
    // history.html keeps both lists in the DOM at once and switches views by
    // `display`, so the same host owns a group title in each — one under
    // `#rh-views-insert`, one under `#rh-views-search-insert`.
    //
    // The title lookup used to be `document.querySelector(...)`, which answers
    // with the first match in document order: always the main list's, whichever
    // view the row came from. Unselecting everything in the search view then
    // cleared the main list's title and left that view's own painted.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'yes';

    const host = 'both.views.test';
    // One grouped row: a title above a `div.group-holder` holding the checkbox
    // — the shape the render loop makes.
    const group = (view) => {
        const title = document.createElement('div');
        title.className = 'item-holder group-title';
        title.setAttribute('title', host);
        title.setAttribute('rel', 'white');
        const holder = document.createElement('div');
        holder.className = 'group-holder';
        holder.setAttribute('rel', host);
        const row = document.createElement('div');
        row.className = 'item-holder';
        row.setAttribute('rel', 'white');
        const checkbox = document.createElement('input');
        checkbox.className = 'chkbx';
        checkbox.value = `https://${host}/x`;
        row.appendChild(checkbox);
        holder.appendChild(row);
        view.appendChild(title);
        view.appendChild(holder);
        title.style.backgroundColor = '#ffcbd3';
        checkbox.checked = true;
        return { title, checkbox };
    };

    // Both views are real containers with the same host inside, and the search
    // one is the ACTIVE view — that is the situation the bug needed. The ids are
    // the registry's elements, which is what `$()`/`getElementById` answer with.
    const mainView = dom.el('rh-views-insert');
    const searchView = dom.el('rh-views-search-insert');
    mainView.style.display = 'none';
    searchView.style.display = 'block';
    t.after(() => {
        mainView.style.display = '';
        searchView.style.display = '';
    });

    const main = group(mainView);
    const search = group(searchView);
    dom.register('#rh-views-search-insert .chkbx', [search.checkbox]);
    dom.register('#rh-views-search-insert .chkbx:checked', [search.checkbox]);

    const master = document.getElementById('master-check-all');
    master.value = 'true'; // -> the "unselect everything" branch
    historyCore.selectHistoryItem(master, 'all');

    assert.equal(search.title.style.backgroundColor, '', 'the search view title was left painted');
    assert.equal(main.title.style.backgroundColor, '#ffcbd3',
        'the main list title was cleared by a sweep that never touched that view');
});

test('a group title is repainted in its own view, and its checkbox means "all of them"', async (t) => {
    // The block that decides a title's colour resolves the title from the row's
    // own container. It used to ask `$$(into + ' div[title="…"]')`, which is
    // scoped by `into` — and `into` is the ACTIVE view, not the view the row
    // was drawn in. Unticking a row in the search view then repainted the main
    // list's copy of the same host.
    //
    // The same block drives the group's own checkbox, and that one really does
    // mean "every row of this group" — a different question from "is anything
    // left", which is what the colour answers.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'yes';

    const host = 'twice.drawn';
    const build = (view) => {
        const title = document.createElement('div');
        title.className = 'item-holder group-title';
        title.setAttribute('title', host);
        title.setAttribute('rel', 'white');
        const chk = document.createElement('input');
        chk.className = 'group-title-checkbox';
        title.appendChild(chk);
        const holder = document.createElement('div');
        holder.className = 'group-holder';
        holder.setAttribute('rel', host);
        const inputs = [];
        for (const rel of ['grey', 'white']) {
            const row = document.createElement('div');
            row.className = 'item-holder';
            row.setAttribute('rel', rel);
            const input = document.createElement('input');
            input.className = 'chkbx';
            input.value = `https://${host}/${rel}`;
            row.appendChild(input);
            holder.appendChild(row);
            inputs.push(input);
        }
        view.appendChild(title);
        view.appendChild(holder);
        return { title, chk, inputs };
    };

    const mainView = dom.el('rh-views-insert');
    const searchView = dom.el('rh-views-search-insert');
    mainView.style.display = 'block';
    searchView.style.display = 'none';
    t.after(() => {
        mainView.children.length = 0;
        searchView.children.length = 0;
        mainView.style.display = '';
        searchView.style.display = '';
    });
    dom.el('master-check-all');

    const main = build(mainView);
    const search = build(searchView);
    for (const group of [main, search]) {
        for (const input of group.inputs) input.checked = true;
        group.title.style.backgroundColor = '#ffcbd3';
        group.chk.checked = true;
    }

    // One row of the search view's group let go: that group still has a ticked
    // row, so it stays painted — but so does the main list's, and only the
    // search one's checkbox drops, because "all of them" is now false there.
    search.inputs[0].checked = false;
    historyCore.selectHistoryItem(search.inputs[0], 'single');

    assert.equal(search.title.style.backgroundColor, '#ffcbd3', 'the group still has a ticked row');
    assert.equal(main.title.style.backgroundColor, '#ffcbd3',
        'the main list title was repainted by a click in the search view');

    // Second row goes: the group is empty, so the colour is released AND the
    // checkbox is false. Releasing the colour is `checked == 0`; the checkbox
    // is `count != checked`, and both have to be visible in one block.
    search.inputs[1].checked = false;
    historyCore.selectHistoryItem(search.inputs[1], 'single');
    assert.equal(search.title.style.backgroundColor, '', 'the group is empty now');
    assert.equal(search.chk.checked, false, 'the title checkbox still claims the group is ticked');
    assert.equal(main.chk.checked, true, 'the other view group was emptied too');

    // …and re-ticking every row brings both back, which is the only way to see
    // that the checkbox follows `count == checked` and not the colour.
    for (const input of search.inputs) input.checked = true;
    historyCore.selectHistoryItem(search.inputs[0], 'single');
    assert.equal(search.title.style.backgroundColor, '#ffcbd3');
    assert.equal(search.chk.checked, true, 'every row ticked again: the checkbox has to follow');
});

test('a group keeps its title while another group still has a ticked row', async (t) => {
    // "Is this group still ticked?" has to be asked of the group, not of the
    // list. Sweeping the whole view answers "is anything ANYWHERE still
    // ticked?", so as long as one row of one other group stayed ticked, the
    // group that had just been emptied kept its colour — and a sweep over the
    // view also costs O(rows) per row, which is 76 seconds over an 8000-row
    // unselect-all against 177ms for the group's own holder. (Both numbers
    // measured with the shim's own element model; the shape is what matters.)
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'yes';
    withRowDom(t, ['grey']);
    const emptied = seedGroupedRow(['grey'], 'empty.host');
    const kept = seedGroupedRow(['white'], 'kept.host');

    for (const group of [emptied, kept]) {
        for (const row of group.rows) row.input.checked = true;
        group.title.style.backgroundColor = '#ffcbd3';
    }

    // The other group is deliberately NOT emptied: it is the bystander that a
    // list-wide sweep would count as "something is still ticked".
    emptied.rows[0].input.checked = false;
    historyCore.selectHistoryItem(emptied.rows[0].input, 'single');

    assert.equal(kept.rows[0].input.checked, true, 'the bystander group is still ticked');
    assert.equal(emptied.title.style.backgroundColor, '',
        'a group that lost its last ticked row kept the title of the group beside it');

    // …and the bystander keeps ITS OWN: the two answers have to be independent,
    // which is the whole point of asking per group.
    assert.equal(kept.title.style.backgroundColor, '#ffcbd3',
        'emptying one group released the title of a group that was never touched');
});

test('unticking one history row keeps the title of the row beside it', async (t) => {
    // A group title shows the whole group, so it is released by the row that
    // empties it and by no earlier one. Clearing it per row left the sibling
    // ticked and unpainted, with the delete button live for a row that looked
    // unselected.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'yes';
    withRowDom(t, ['grey']);
    const { title, rows } = seedGroupedRow(['grey', 'white'], 'pair.host');
    for (const row of rows) row.input.checked = true;
    title.style.backgroundColor = '#ffcbd3';

    rows[0].input.checked = false;
    historyCore.selectHistoryItem(rows[0].input, 'single');

    assert.equal(rows[1].input.checked, true, 'the sibling is still ticked');
    assert.equal(title.style.backgroundColor, '#ffcbd3',
        'the still-ticked sibling lost the only thing that showed its selection');

    // The last one out releases it: the title would otherwise stay pink over a
    // group with nothing ticked in it.
    rows[1].input.checked = false;
    historyCore.selectHistoryItem(rows[1].input, 'single');
    assert.equal(title.style.backgroundColor, '',
        'the group is empty now, so the title has to go back to the stylesheet');

    // …and the sweep behind "unselect all" agrees, which is the same rule from
    // the bulk side.
    title.style.backgroundColor = '#ffcbd3';
    for (const row of rows) row.input.checked = true;
    const master = document.getElementById('master-check-all');
    master.value = 'true';
    historyCore.selectHistoryItem(master, 'all');
    assert.equal(title.style.backgroundColor, '', 'the title kept its selection colour');
});

test('withRowDom hands the ambient querySelectorAll back when the test ends', async (t) => {
    // A test that swaps in a DOM helper has to put the original back — the
    // suite shares one `document` for the whole file, so a leak reaches every
    // test after it and makes unrelated failures depend on file order.
    //
    // The restore hook is the trap: `const saved = document` is not a snapshot,
    // so `document.querySelectorAll = saved.querySelectorAll` runs *after* the
    // walker is installed and puts the walker back. Nothing caught it because
    // the tests that follow only use selectors the shim registry answers, and
    // the walker answers those with the same []. This asserts the identity of
    // the function, which is the only thing that can tell the two apart.
    const ambient = document.querySelectorAll;
    withRowDom(t, ['grey']);
    assert.notEqual(document.querySelectorAll, ambient, 'the walker was never installed');

    // Registered *after* withRowDom's restore hook, and `t.after` hooks run
    // newest-first, so this one only fires once the restore has already run —
    // which is exactly the state a later test would see.
    t.after(() => {
        assert.equal(document.querySelectorAll, ambient,
            'withRowDom left its walker installed on the shared document');
    });
});

test('"unselect all" leaves no inline colour behind, on either row colour', async (t) => {
    // Both row colours in one sweep, because the bug was a mismatch *between*
    // them: the odd rows kept a shade that the single uncheck above never
    // produced, so "select all / unselect all" was not a no-op.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'no';
    const rows = withRowDom(t, ['white', 'grey']);
    const master = document.getElementById('master-check-all');

    for (const { holder, input } of rows) {
        input.checked = true;
        historyCore.selectHistoryItem(input, 'single');
        assert.equal(holder.style.backgroundColor, '#ffcbd3', 'both rows must start selected');
    }

    master.value = 'true'; // -> the "unselect everything" branch
    historyCore.selectHistoryItem(master, 'all');

    for (const { holder } of rows) {
        assert.equal(holder.style.backgroundColor, '',
            `a ${holder.getAttribute('rel')} row kept an inline colour after "unselect all"`);
    }
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

test('dateFormat falls back to the default until storage is ready', async (t) => {
    // Every page script builds its date dropdowns by string-replacing on this
    // key. It reads `undefined` in the window before storage-adapter.js has
    // resolved chrome.storage.local, and the `.replace()` on the next line then
    // threw inside the page's own DOMContentLoaded handler — taking the rest of
    // the page's initialisation with it. Roughly one cold start in three hit it.
    const h = await importModule('modules/helpers.js');
    restoreStorage(t, ['rh-date']);
    delete localStorage['rh-date'];
    assert.equal(h.dateFormat(), 'mm/dd/yyyy');

    localStorage['rh-date'] = 'yyyy/mm/dd';
    assert.equal(h.dateFormat(), 'yyyy/mm/dd');
});

/**
 * Drive `deleteHistoryItem('selected')` with one checked row and a stub
 * `chrome.history.deleteUrl`, returning the URLs it was called with and whether
 * it got a callback at all.
 *
 * The callback flag is the point: `deleteUrl()` reports failure through
 * `chrome.runtime.lastError`, which is only delivered to a callback. A stub that
 * calls `cb()` unconditionally cannot tell "passed a callback" from "passed
 * none", so the assertion would rest on the URL alone and stay green after the
 * implementation dropped the callback — the exact regression this helper exists
 * to catch.
 */
async function runSelectedDelete(t, deleteUrl) {
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'no';

    const root = dom.el('rh-views-insert');
    root.style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    dom.el('alert-holder').style.display = 'none';
    dom.el('alert-holder-loading');

    // The row the delete sweep removes: `div.item-holder` wrapping the checked
    // checkbox. It has to be a real ancestor — deleteHistoryItem() reaches the
    // row with `el.closest('div.item-holder').remove()`.
    const holder = dom.makeEl('div');
    holder.className = 'item-holder';
    const input = dom.makeEl('input');
    input.className = 'chkbx';
    input.value = 'https://gone.test/page';
    input.checked = true;
    holder.appendChild(input);
    root.appendChild(holder);
    dom.register('#rh-views-insert .checkbox input:checked', [input]);

    const seen = [];
    const callbackPassed = [];
    await withChromeApi({
        history: {
            deleteUrl: (o, cb) => {
                seen.push(o.url);
                callbackPassed.push(typeof cb === 'function');
                deleteUrl(o);
                if (typeof cb === 'function') cb();
            },
            search: (_q, cb) => cb([]),
        },
        runtime: { lastError: undefined, id: 'test-extension-id' },
    }, async () => {
        historyCore.deleteHistoryItem('selected');
    });
    return { seen, callbackPassed, input, holder, root };
}

test('deleteHistoryItem("selected") passes a callback so a failed delete is visible', async (t) => {
    // chrome.history.deleteUrl() reports through chrome.runtime.lastError, not
    // by throwing. Called without a callback the failure is simply lost: the
    // row was already removed from the DOM, so the user sees a page disappear
    // from the list and come back on the next load with nothing to explain it.
    //
    // Asserted as "the callback was a function", not just "deleteUrl was
    // called": the URL was already right in the version that passed no
    // callback at all, so a URL-only assertion cannot see this regression.
    const { seen, callbackPassed } = await runSelectedDelete(t, () => {});
    assert.deepEqual(seen, ['https://gone.test/page']);
    assert.deepEqual(callbackPassed, [true], 'deleteUrl has to be given a callback');
});

test('deleteHistoryItem("selected") survives a deleteUrl that reports an error', async (t) => {
    // The failure path itself must not throw: it runs inside the same loop that
    // removes the rows, and a throw there leaves the rest of the list intact
    // while the page has already been half-cleared.
    const historyCore = await importModule('modules/history-core.js');
    restoreStorage(t, ['rh-group']);
    localStorage['rh-group'] = 'no';
    const root = dom.el('rh-views-insert');
    root.style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    dom.el('alert-holder').style.display = 'none';
    dom.el('alert-holder-loading');

    const holder = dom.makeEl('div');
    holder.className = 'item-holder';
    const input = dom.makeEl('input');
    input.className = 'chkbx';
    input.value = 'https://gone.test/page';
    input.checked = true;
    holder.appendChild(input);
    root.appendChild(holder);
    dom.register('#rh-views-insert .checkbox input:checked', [input]);

    const savedWarn = console.warn;
    const warned = [];
    console.warn = (...args) => warned.push(args.join(' '));
    t.after(() => { console.warn = savedWarn; });

    assert.doesNotThrow(() => withChromeApi({
        history: {
            deleteUrl: (_o, cb) => {
                globalThis.chrome.runtime.lastError = { message: 'no such url' };
                cb();
                delete globalThis.chrome.runtime.lastError;
            },
            search: (_q, cb) => cb([]),
        },
        runtime: { lastError: undefined, id: 'test-extension-id' },
    }, () => historyCore.deleteHistoryItem('selected')));

    assert.equal(warned.length, 1, 'the failure has to be reported somewhere');
    assert.match(warned[0], /no such url/);
});

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

test('deleteHistoryItem("range") runs the caller redraw once the delete lands', async (t) => {
    // The deleted `window.calendar('yes','')` sat in this callback, and the
    // redraw cannot move into this module: calendar.js imports history() from
    // here, so importing it back would close a cycle. It is a parameter the
    // caller fills in — history.js owns the calendar.
    //
    // Without the redraw the symptom is quiet: the delete happens, the list
    // reloads, and the heat map of every day but the selected one keeps the
    // counts from before the delete.
    const historyCore = await importModule('modules/history-core.js');
    seedRangeInputs(t, 'yyyy/mm/dd', '2026/09/01', '2026/09/10');
    // history('yes','') runs inside the deleteRange() callback and reads the
    // page's date dropdowns, so it needs the same fixture the render tests use.
    dom.setOptions('rh-what', ['current', 'all'], 'current');
    dom.el('rh-views-insert').style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    dom.setOptions('date-select-day', ['01', '02'], '01');
    dom.setOptions('date-select-month', ['01', '09'], '09');
    dom.setOptions('date-select-year', ['2026'], '2026');
    dom.el('rh-search');
    dom.el('calendar-total-value');
    dom.el('master-check-all');

    let redrawn = 0;
    let deleted = null;
    await withChromeApi({
        history: {
            deleteRange: (range, cb) => { deleted = range; cb(); },
            search: (_q, cb) => cb([]),
        },
    }, async () => {
        historyCore.deleteHistoryItem('range', function () { redrawn++; });
    });

    assert.ok(deleted, 'deleteRange() was never called');
    assert.equal(redrawn, 1, 'the caller owns the calendar, so its redraw has to run');
});

test('deleteHistoryItem("range") completes when the caller passes no redraw', async (t) => {
    const historyCore = await importModule('modules/history-core.js');
    seedRangeInputs(t, 'yyyy/mm/dd', '2026/09/01', '2026/09/10');
    // history('yes','') runs inside the deleteRange() callback and reads the
    // page's date dropdowns, so it needs the same fixture the render tests use.
    dom.setOptions('rh-what', ['current', 'all'], 'current');
    dom.el('rh-views-insert').style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    dom.setOptions('date-select-day', ['01', '02'], '01');
    dom.setOptions('date-select-month', ['01', '09'], '09');
    dom.setOptions('date-select-year', ['2026'], '2026');
    dom.el('rh-search');
    dom.el('calendar-total-value');
    dom.el('master-check-all');

    // The delete itself must not depend on the page wiring a redraw.
    await withChromeApi({
        history: {
            deleteRange: (_range, cb) => cb(),
            search: (_q, cb) => cb([]),
        },
    }, async () => {
        assert.doesNotThrow(() => historyCore.deleteHistoryItem('range'));
    });
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

    // Noon today, built from its components rather than from `now`:
    // history('current') asks for the 24 hours ending at 23:59:59.999 TODAY,
    // so a fixture built as `now - 1h` lands in yesterday and is filtered out
    // whenever the suite runs in the first hour of the day. That is exactly
    // what happened in CI (UTC+8, 00:41 local): the render loop then had
    // nothing to draw and every assertion below counted zero.
    const today = new Date();
    const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0).getTime();
    const items = [
        { id: '1', url: 'https://alpha.test/1', title: 'A1', visitCount: 1, lastVisitTime: noon },
        { id: '2', url: 'https://alpha.test/2', title: 'A2', visitCount: 1, lastVisitTime: noon + 60000 },
        { id: '3', url: 'https://beta.test/1', title: 'B1', visitCount: 1, lastVisitTime: noon + 120000 },
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

test('recentHistory lists pages, not internal URLs', async (t) => {
    // The popup used to compute `test = /^(file|chrome|…)/.test(url)` and then
    // never use it, so opening a local file put it in "recent history" next to
    // real pages. The service worker already leaves those out of its
    // most-visited cache — this brings the two lists back to one answer.
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['rh-itemsno']);

    const holder = dom.el('rh-inject');
    holder.innerHTML = '';
    localStorage['rh-itemsno'] = '3';

    // `TS` is a fixed date in 2024; recentHistory() only lists the last 28
    // days, so entries stamped with it would all be filtered out and the
    // assertions below would pass for the wrong reason. "now" keeps the
    // fixture about internal URLs, which is what this test is for.
    const now = Date.now();
    const entries = [
        { url: 'file:///home/me/notes.txt', title: 'Notes' },
        { url: 'chrome://extensions', title: 'Extensions' },
        { url: 'https://alpha.test/1', title: 'A1' },
        { url: 'chrome-extension://abcdefg/popup.html', title: 'Popup' },
        { url: 'https://beta.test/1', title: 'B1' },
    ].map((e) => ({ ...e, visitCount: 1, lastVisitTime: now }));

    withChromeApi({ history: { search: (_q, cb) => cb(entries) } }, () => {
        popupCore.recentHistory();
    });

    const rendered = holder.children.map((el) => el.innerHTML).join('\n');

    // Three slots were configured; the two internal URLs must not eat them.
    // If they did, this would render 2 instead — silently, with no error.
    assert.equal(holder.children.length, 2, 'internal URLs must not occupy slots meant for pages');
    assert.doesNotMatch(rendered, /file:\/\/\/home/, 'a local file must not be listed');
    assert.doesNotMatch(rendered, /chrome:\/\/extensions/, "the browser's own pages must not be listed");
    assert.match(rendered, /https:\/\/alpha\.test\/1/);
    assert.match(rendered, /https:\/\/beta\.test\/1/);
});

test('recentHistory drops entries older than 28 days without spending a slot', async (t) => {
    // The window used to be passed to chrome.history.search as startTime,
    // which makes the backend scan by time range — hundreds of milliseconds on
    // a large profile. It is now applied in JS, and this pins down the part
    // that is easy to get wrong: an old entry must be skipped *without*
    // counting towards the configured number of items, or a filtered-down
    // history would render short.
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['rh-itemsno']);

    const holder = dom.el('rh-inject');
    holder.innerHTML = '';
    localStorage['rh-itemsno'] = '2';

    const now = Date.now();
    const DAY = 24 * 3600 * 1000;
    const entries = [
        { url: 'https://old.test/a', title: 'Old A', visitCount: 9, lastVisitTime: now - 40 * DAY },
        { url: 'https://new.test/a', title: 'New A', visitCount: 1, lastVisitTime: now },
        { url: 'https://old.test/b', title: 'Old B', visitCount: 8, lastVisitTime: now - 30 * DAY },
        { url: 'https://new.test/b', title: 'New B', visitCount: 1, lastVisitTime: now - 1000 },
        { url: 'https://new.test/c', title: 'New C', visitCount: 1, lastVisitTime: now - 2000 },
        { url: 'https://new.test/d', title: 'New D', visitCount: 1, lastVisitTime: now - 3000 },
    ];

    withChromeApi({ history: { search: (_q, cb) => cb(entries) } }, () => {
        popupCore.recentHistory();
    });

    const rendered = holder.children.map((el) => el.innerHTML).join('\n');

    assert.equal(holder.children.length, 2, 'two slots were configured and two recent pages exist');
    assert.doesNotMatch(rendered, /old\.test/, 'a page last visited 40 days ago must not be listed');
    assert.match(rendered, /https:\/\/new\.test\/a/);
    assert.match(rendered, /https:\/\/new\.test\/b/);
});

test('showRecentTabs reads the tab list from session storage instead of waking the worker', async (t) => {
    // The block used to fetch openedTabs/recentTabs with runtime.sendMessage.
    // A message wakes the service worker, and a worker that wakes re-runs its
    // startup crawl — seconds of work whose only result here is a list of tabs,
    // and on a cold start it was answered from empty module scope anyway.
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['rt-itemsno']);
    t.after(() => env.sessionStore.clear());

    const holder = dom.el('rt-inject');
    holder.innerHTML = '';
    localStorage['rt-itemsno'] = '6';
    env.sessionStore.set('tab-list', {
        v: 1,
        openedTabs: { 5: { id: 5, url: 'https://a.test/1', title: 'A1' } },
        recentTabs: [5],
    });

    let messages = 0;
    let queries = 0;
    await withChromeApi({
        runtime: { ...globalThis.chrome.runtime, sendMessage: () => { messages++; return Promise.resolve(); } },
        tabs: { query: (_q, cb) => { queries++; cb([]); } },
    }, async () => {
        popupCore.showRecentTabs();
        await new Promise((r) => setTimeout(r, 0));
    });

    assert.equal(messages, 0, 'a message wakes the service worker; the tab list must not need one');
    assert.equal(queries, 0, 'a session snapshot is enough, so no live-tab query either');
    assert.equal(holder.children.length, 1, 'the snapshot has to reach the DOM');
});

test('showRecentTabs falls back to a live tab query when there is no snapshot', async (t) => {
    // First popup after a browser start, before the worker has saved anything.
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['rt-itemsno']);
    // Cleared here as well as afterwards: the fallback only runs with no
    // snapshot present, and leaning on the neighbouring test's t.after to have
    // emptied it makes this one fail when it is run alone or reordered.
    env.sessionStore.clear();
    t.after(() => env.sessionStore.clear());

    const holder = dom.el('rt-inject');
    holder.innerHTML = '';
    localStorage['rt-itemsno'] = '6';

    let messages = 0;
    let queries = 0;
    await withChromeApi({
        runtime: { ...globalThis.chrome.runtime, sendMessage: () => { messages++; return Promise.resolve(); } },
        tabs: {
            query: (_q, cb) => {
                queries++;
                cb([
                    { id: 2, url: 'https://b.test/1', title: 'B1', active: false, windowId: 1, index: 0 },
                    { id: 1, url: 'https://a.test/1', title: 'A1', active: true, windowId: 1, index: 1 },
                ]);
            },
        },
    }, async () => {
        popupCore.showRecentTabs();
        await new Promise((r) => setTimeout(r, 0));
    });

    assert.equal(queries, 1, 'the fallback must query live tabs');
    assert.equal(messages, 0, 'the fallback must not reach for the service worker either');
    // Activation order is not recoverable from a live query, so the active tab
    // leads and the rest follow in window order.
    assert.equal(holder.children.length, 2, 'both open tabs are listed');
    assert.match(holder.children[0].innerHTML, /https:\/\/a\.test\/1/, 'the active tab comes first');
    assert.match(holder.children[1].innerHTML, /https:\/\/b\.test\/1/);
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

test('mostVisited stops at the end of the cache instead of throwing', async (t) => {
    // The loop walked MOST_VISITED_MAX (45) rows, but the worker only writes
    // as many as survive its own filters — internal URLs and the 28-day window
    // — so `mvd[i]` was undefined for most `i` and `mvd[i].title` threw. It
    // threw inside popup.js' block loop, so every block after this one never
    // rendered: the popup stopped half way down with no error in the UI.
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);

    const holder = dom.el('mv-inject');
    holder.innerHTML = '';
    // Three cached rows against a configured 8: the realistic case, not the
    // 45 the loop assumed.
    localStorage['mv-cache'] = JSON.stringify([
        { url: 'https://a.test/1', title: 'A1', favicon: '', visitCount: 9 },
        { url: 'https://b.test/1', title: 'B1', favicon: '', visitCount: 8 },
        { url: 'https://c.test/1', title: 'C1', favicon: '', visitCount: 7 },
    ]);
    localStorage['mv-itemsno'] = '8';
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited());
    assert.equal(holder.children.length, 3, 'every cached row is rendered');
    assert.match(holder.children[2].innerHTML, /https:\/\/c\.test\/1/);
});

test('mostVisited renders nothing on a cold start', async (t) => {
    // `mv-cache` is absent until the worker has written it once, and the old
    // guard only excluded the 'false' sentinel — so a brand-new profile threw
    // in JSON.parse(undefined) on its very first popup.
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);

    const holder = dom.el('mv-inject');
    holder.innerHTML = '';
    delete localStorage['mv-cache'];
    localStorage['mv-itemsno'] = '8';
    localStorage['mv-blocklist'] = 'false';

    assert.doesNotThrow(() => popupCore.mostVisited());
    assert.equal(holder.children.length, 0);
});

test('mostVisited honours the blocklist and the configured item count', async (t) => {
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['mv-cache', 'mv-itemsno', 'mv-blocklist']);

    const holder = dom.el('mv-inject');
    holder.innerHTML = '';
    localStorage['mv-cache'] = JSON.stringify([
        { url: 'https://a.test/1', title: 'A1', favicon: '', visitCount: 9 },
        { url: 'https://b.test/1', title: 'B1', favicon: '', visitCount: 8 },
        { url: 'https://c.test/1', title: 'C1', favicon: '', visitCount: 7 },
    ]);
    localStorage['mv-itemsno'] = '1';
    localStorage['mv-blocklist'] = 'https://a.test/1|';

    popupCore.mostVisited();

    // A blocked row must not consume a slot, same as the internal URLs in
    // recentHistory(): it is skipped, and the next candidate takes its place.
    assert.equal(holder.children.length, 1);
    assert.doesNotMatch(holder.children[0].innerHTML, /a\.test/);
    assert.match(holder.children[0].innerHTML, /https:\/\/b\.test\/1/);
});

test('pinned() renders every stored pinned item', async (t) => {
    // The pin button is gone from the popup rows, but `rh-pinned` still holds
    // entries pinned before it was removed. The block is what keeps them
    // reachable — and it is the only caller of the 'pi' branch in formatItem().
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['rh-pinned']);

    const holder = dom.el('pi-inject');
    holder.innerHTML = '';
    localStorage['rh-pinned'] = JSON.stringify([
        { url: 'https://a.test/1', title: 'A1', favicon: '', time: '10:00' },
        { url: 'https://b.test/1', title: 'B1', favicon: '', time: '10:05' },
    ]);

    popupCore.pinned();

    assert.equal(holder.children.length, 2, 'both pinned entries are listed');
    assert.match(holder.children[0].innerHTML, /https:\/\/a\.test\/1/);
    // The old code walked a hard-coded 99 slots; a longer list was cut there
    // without saying so. This is still a bound, just an explicit one.
    assert.doesNotThrow(() => popupCore.pinned());
});

test('pinned() renders nothing for the "false" sentinel', async (t) => {
    const popupCore = await importModule('modules/popup-core.js');
    restoreStorage(t, ['rh-pinned']);

    const holder = dom.el('pi-inject');
    holder.innerHTML = '';
    localStorage['rh-pinned'] = 'false';

    assert.doesNotThrow(() => popupCore.pinned());
    assert.equal(holder.children.length, 0);
});

test('saveOptions leaves settings without an options-page control alone', async (t) => {
    // rh-group / rh-orderby / rh-order are changed by the sort toolbar on
    // history.html and bookmark.html, which writes them straight to storage.
    // The options page has no control for them, so if saveOptions() wrote them
    // it would write the *default* back and silently undo a choice the user
    // just made. `rh-pinned` is the same shape: it holds entries the user
    // pinned before the per-row pin button was removed, the block still renders
    // them, and nothing in the extension can add to the list any more.
    const untouched = ['rh-group', 'rh-orderby', 'rh-order', 'rh-pinned'];

    formDefaults();
    restoreStorage(t, untouched);
    // Deleted rather than set to a sentinel: a save that reads them back out of
    // storage and writes the value straight through would look unchanged. What
    // matters is whether saveOptions() touches the key at all.
    for (const key of untouched) delete localStorage[key];

    config.saveOptions(false);

    for (const key of untouched) {
        assert.equal(localStorage[key], undefined, `saveOptions wrote ${key}, which has no control here`);
    }
});

// ---------------------------------------------------------------------------
// Heat map aggregation (calendar-storage.js)
//
// The map is `{ dayKey: rowCount }` and it is written by two runtimes. These
// tests pin the contract both rely on: which day a query window belongs to,
// and whether a write is allowed to replace what is already there.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

/**
 * The map's key for the day `t` falls on: `t`'s date at 23:59:59.999.
 *
 * Written out here rather than imported so that a change to the module's own
 * `dayKey()` cannot silently redefine what these tests consider correct.
 * Note it is the day's *end*, not its midnight — a day's window is
 * `[dayEnd - DAY, dayEnd]`, so the key has to be the inclusive end or every
 * entry shifts back by one day.
 */
function dayKeyOf(t) {
    const d = new Date(t);
    d.setHours(23);
    d.setMinutes(59);
    d.setSeconds(59);
    d.setMilliseconds(999);
    return d.getTime();
}

/** A `[dayEnd - DAY, dayEnd]` window covering the day `offsetDays` from today. */
function dayWindow(offsetDays) {
    const end = dayKeyOf(Date.now() + offsetDays * DAY_MS);
    return { text: '', maxResults: 0, startTime: end - DAY_MS, endTime: end };
}

/**
 * Empty the map before a test asserts on it.
 *
 * `calendar_storage2` is live module state, not storage: it is read once when
 * the module is first imported and every later write mutates that same object.
 * `restoreStorage()` only puts `localStorage` back, so without this the days a
 * previous test recorded are still in the map and "was this day written?"
 * answers yes for reasons that have nothing to do with the test asking.
 */
function clearCalendarMap(calendar_storage2) {
    for (const key of Object.keys(calendar_storage2)) delete calendar_storage2[key];
}

test('save_calendar_storage2 accepts the Service Worker\'s maxResults: 0 query', async (t) => {
    // Regression guard for the bug that made the heat map click-only: the
    // recorder used to require `maxResults >= 9999` as a stand-in for "this is
    // a full-day sample". The Service Worker asks with `maxResults: 0`, which
    // means the same thing ("unlimited") but is numerically less than 9999 — so
    // *every* Service Worker write was dropped and no square ever got painted
    // without being clicked first.
    const { save_calendar_storage2, calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2']);
    clearCalendarMap(calendar_storage2);

    const win = dayWindow(-1);
    save_calendar_storage2(win, 7, false);

    // Keyed by the window's END: that is the day the window covers, and the
    // day calendar.js builds its cells from.
    assert.equal(calendar_storage2[dayKeyOf(win.endTime)], 7);
});

test('save_calendar_storage2 keys the map by the queried day, not by today', async (t) => {
    // The old guard was `(startTime - _DATE + 1) % DAY == 0`, and this case was
    // originally written as if that guard had rejected anything but today. It
    // did not: both ends of any day's window are the same 23:59:59.999, so the
    // expression is 0 for every offset — the guard never rejected anything.
    // The only thing that actually blocked a non-today write was the
    // `maxResults >= 9999` field check above, and that is covered by the
    // `maxResults: 0` case.
    //
    // So what this case is for is the *window* check that replaced it
    // (`endTime - startTime == DAY`), from the caller's side: a day that is not
    // today still goes in, keyed by its own end. The offsets are what make it
    // different from the case above rather than a re-run of it.
    const { save_calendar_storage2, calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2']);
    clearCalendarMap(calendar_storage2);

    for (const offset of [-1, -5, -40]) {
        const win = dayWindow(offset);
        save_calendar_storage2(win, 3, false);
        assert.equal(calendar_storage2[dayKeyOf(win.endTime)], 3, `day ${offset} was not recorded`);
    }
});

test('save_calendar_storage2 only fills gaps unless told to overwrite', async (t) => {
    const { save_calendar_storage2, calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2']);
    clearCalendarMap(calendar_storage2);

    const win = dayWindow(-2);
    const key = dayKeyOf(win.endTime);

    save_calendar_storage2(win, 10, false);
    save_calendar_storage2(win, 99, false);
    assert.equal(calendar_storage2[key], 10, 'a non-overwriting write must not replace a real value');

    save_calendar_storage2(win, 99, true);
    assert.equal(calendar_storage2[key], 99, 'an overwriting write must replace it');
});

test('save_calendar_storage2 ignores windows that are not exactly one day', async (t) => {
    const { save_calendar_storage2, calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2']);
    clearCalendarMap(calendar_storage2);

    const win = dayWindow(-1);
    const key = dayKeyOf(win.endTime);

    save_calendar_storage2({ ...win, endTime: win.endTime + DAY_MS }, 5, true);
    assert.equal(calendar_storage2[key], undefined, 'a multi-day window has no single day to belong to');

    save_calendar_storage2({ ...win, text: 'keyword' }, 5, true);
    assert.equal(calendar_storage2[key], undefined, 'a filtered search is not a whole-day total');
});

test('calendarLevel puts a count in the same tier the calendar paints', async () => {
    const { calendarLevel } = await importModule('modules/shared/calendar-storage.js');

    // Boundaries are pinned on both sides: the tiers are what the user sees,
    // and they used to be written out three separate times.
    assert.equal(calendarLevel(undefined), 0);
    assert.equal(calendarLevel(0), 0);
    assert.equal(calendarLevel(1), 1);
    assert.equal(calendarLevel(49), 1);
    assert.equal(calendarLevel(50), 2);
    assert.equal(calendarLevel(99), 2);
    assert.equal(calendarLevel(100), 3);
    assert.equal(calendarLevel(149), 3);
    assert.equal(calendarLevel(150), 4);
    assert.equal(calendarLevel(100000), 4);
});

// ---------------------------------------------------------------------------
// Who may overwrite a heat-map day, and what a day of 0 means
//
// `history()` is the map's only page-side writer. Two things about it decide
// whether the tiers mean anything, and neither is visible from the shared
// helper's own tests: which day counts as "today" (only today may overwrite),
// and that an empty list still gets written (a count of 0 is a *deletion*).
// ---------------------------------------------------------------------------

/**
 * Put the fixture `history()` needs on the page.
 *
 * The date dropdowns are what `history('yes', '')` reads its query window
 * from, so the day under test is chosen by writing them — the same path a
 * calendar click takes. Everything else is the shape the render tests use.
 */
function seedHistoryPage() {
    // `formatDate()` reads `rh-date` at *call* time and returns `undefined`
    // without it, which then reaches `.replace()` inside history(). Storage is
    // shared by this whole file, and several fixtures start with `env.reset()`
    // — so this is set here rather than assumed from an earlier test.
    if (localStorage['rh-date'] === undefined) localStorage['rh-date'] = 'yyyy/mm/dd';
    dom.setOptions('rh-what', ['current', 'all'], 'current');
    dom.el('rh-views-insert').style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    dom.el('rh-search');
    dom.el('delete-range-one');
    dom.el('delete-range-two');
    dom.el('master-check-all');
    dom.el('calendar-total-value');
    dom.el('alert-holder').style.display = 'block';
    dom.el('alert-holder-loading');
}

/**
 * Drive `history('yes', '')` for the day `daysAgo` days back and report that
 * day's key.
 *
 * `entries` is what `chrome.history.search` answers with. The render loop is a
 * `setInterval`, but nothing here asserts on the DOM, so it is left to run out
 * on its own.
 */
async function showDay(daysAgo, entries) {
    const historyCore = await importModule('modules/history-core.js');
    seedHistoryPage();

    const target = new Date();
    target.setDate(target.getDate() - daysAgo);
    dom.setOptions('date-select-year', [String(target.getFullYear())], String(target.getFullYear()));
    dom.setOptions('date-select-month', [String(target.getMonth() + 1).padStart(2, '0')], String(target.getMonth() + 1).padStart(2, '0'));
    dom.setOptions('date-select-day', [String(target.getDate()).padStart(2, '0')], String(target.getDate()).padStart(2, '0'));

    withChromeApi({ history: { search: (_q, cb) => cb(entries) } }, () => {
        historyCore.history('yes', '');
    });
    return dayKeyOf(target.getTime());
}

/** A history row `hours` before `end`, on the day ending at `end`. */
function rowOn(end, hours, i) {
    return {
        id: 'row' + i,
        url: `https://day.test/${i}`,
        title: `Day ${i}`,
        visitCount: 1,
        lastVisitTime: end - hours * 3600000,
    };
}

test('the page may only overwrite today, never a day it merely happens to display', async (t) => {
    // The dropdown is not necessarily on today: clicking a calendar cell
    // rewrites it. With `overwrite: true` hardcoded, a click on the 3rd would
    // replace the crawl's *visit* count for the 3rd with the page's *row*
    // count — one column of the map quietly switching measures, which is the
    // exact race this PR set out to remove.
    const { calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2', 'rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    clearCalendarMap(calendar_storage2);
    localStorage['rh-group'] = 'no';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    const key = dayKeyOf(Date.now() - 3 * DAY_MS);
    const shown = await showDay(3, [rowOn(key, 1, 1), rowOn(key, 2, 2)]);
    assert.equal(shown, key, 'the fixture must drive the day three days back');

    assert.equal(calendar_storage2[key], 2, 'an empty older day still gets filled in');
});

test('a day the crawl already counted survives a visit to that day in the page', async (t) => {
    // The observable form of the rule above: the crawl's count for an older
    // day is not replaced just because the user looked at that day. The two
    // writers measure different things there (visits vs rows), so replacing
    // one with the other changes what the square means.
    const { calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2', 'rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    clearCalendarMap(calendar_storage2);
    localStorage['rh-group'] = 'no';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    const key = dayKeyOf(Date.now() - 3 * DAY_MS);
    calendar_storage2[key] = 4242; // what the crawl wrote

    await showDay(3, [rowOn(key, 1, 1), rowOn(key, 2, 2)]);

    assert.equal(calendar_storage2[key], 4242,
        'the page overwrote a day it is not the authority on');
});

test('today is still the page\'s to overwrite', async (t) => {
    // The other half, and the reason the flag is not simply `false`: only the
    // page can see browsing that happened after the crawl ran, so today's
    // fresher count must win.
    const { calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2', 'rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    clearCalendarMap(calendar_storage2);
    localStorage['rh-group'] = 'no';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    const key = dayKeyOf(Date.now());
    calendar_storage2[key] = 4242; // a stale number, written earlier today

    await showDay(0, [rowOn(key, 1, 1), rowOn(key, 2, 2), rowOn(key, 3, 3)]);

    assert.equal(calendar_storage2[key], 3, 'today\'s count must replace whatever was there');
});

test('a day that just became empty is dropped from the map', async (t) => {
    // `save_calendar_storage2(obj, 0, …)` deletes the entry — that deletion is
    // the only code in the extension that removes a heat-map entry, and it is
    // what stops a range-deleted day from staying coloured.
    //
    // The call therefore has to happen when the list comes back *empty* too.
    // It used to sit inside `if (rha.length > 0)`, so the one case the
    // deletion exists for could never reach it: after deleting today's
    // history the cell kept its old green, `history()` only rewrote the total
    // line, and nothing else would ever correct it.
    const { calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2', 'rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    clearCalendarMap(calendar_storage2);
    localStorage['rh-group'] = 'no';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    const key = dayKeyOf(Date.now());
    calendar_storage2[key] = 12; // the day was counted, then its history was deleted

    await showDay(0, []);

    assert.equal(calendar_storage2[key], undefined,
        'an empty day must be deleted from the map, not skipped');
});

test('a day that just became empty also loses the colour it was painted with', async (t) => {
    // The map entry and the DOM are two different places, and deleting a day
    // fixes only the first. The order a range delete runs in makes the second
    // certain: `deleteHistoryItem('range')` calls `calendar('yes','')` *first*
    // — which repaints the whole month from a map that still holds the day —
    // and only then calls `history('yes','')`, which is where the entry is
    // finally removed. So by the time the count is zero the cell has just been
    // given its old colour, and nothing is left to take it away.
    //
    // The symptom is a square reading "0" next to a dark green cell.
    const { calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    const { paintDay } = await importModule('modules/calendar-colors.js');
    restoreStorage(t, ['calendar-storage2', 'rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    clearCalendarMap(calendar_storage2);
    localStorage['rh-group'] = 'no';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    const key = dayKeyOf(Date.now());
    calendar_storage2[key] = 12; // the day was counted, then its history was deleted

    // The cell as calendar() leaves it. `paintDay` is the same code calendar()
    // uses, so this is not a hand-written colour that could drift from it.
    const cell = dom.makeEl('a');
    paintDay(cell, 120);
    assert.equal(cell.style.backgroundColor, '#6dc738', 'the fixture must start from a painted cell');
    const lookup = document.querySelector;
    document.querySelector = (sel) => (String(sel).includes('a#selected') ? cell : lookup.call(document, sel));

    try {
        await showDay(0, []);
    } finally {
        document.querySelector = lookup;
    }

    assert.equal(cell.style.backgroundColor, '',
        'the cell still shows the count that was just deleted — nothing else repaints it');
});

test('the deletion reaches storage, so the next page start sees it too', async (t) => {
    // `calendar_storage2` is in-memory; the map only survives a reload if the
    // delete is followed by a write.
    const { calendar_storage2 } = await importModule('modules/shared/calendar-storage.js');
    restoreStorage(t, ['calendar-storage2', 'rh-group', 'rh-orderby', 'rh-order', 'rh-date', 'rh-timeformat']);
    clearCalendarMap(calendar_storage2);
    localStorage['rh-group'] = 'no';
    localStorage['rh-orderby'] = 'time';
    localStorage['rh-order'] = 'desc';
    localStorage['rh-date'] = 'yyyy/mm/dd';
    localStorage['rh-timeformat'] = '24';

    const key = dayKeyOf(Date.now());
    calendar_storage2[key] = 12;

    await showDay(0, []);

    assert.deepEqual(JSON.parse(localStorage['calendar-storage2']), {},
        'the map still holds the deleted day');
});
test('calendar() draws the month the dropdowns name, not the current year', async (t) => {
    // Every cell's `rel` carries the year the page will load, and its colour is
    // looked up under that year's key. `new Date().getFullYear()` broke both:
    // browsing to a month in another year drew this year's weekday offsets
    // (Saturday/Sunday landing on the wrong days) and painted each square with
    // the count belonging to the same month of *this* year.
    const { calendar } = await importModule('modules/calendar.js');
    restoreStorage(t, ['rh-date', 'rh-timeformat']);
    dom.setOptions('date-select-day', ['01', '02'], '01');
    dom.setOptions('date-select-month', ['01', '02', '12'], '12');
    dom.setOptions('date-select-year', ['2025', '2024'], '2024');
    const days = dom.el('calendar-days');

    calendar('selected', '');

    const cells = days.children.filter((el) => el.tagName === 'A');
    assert.ok(cells.length > 0, 'the month was not drawn');
    assert.equal(cells[0].getAttribute('rel'), '1|12|2024',
        'the first cell has to name the year the dropdowns are on');
});

// ---------------------------------------------------------------------------
// bookmark.js — the colour a bookmark row shows
//
// Rows on `bookmark.html` render the same two ways as on the history page:
// ungrouped (each `div.item-holder` carries `rel="white"`/`"grey"` and takes its
// colour from the stylesheet) and grouped (the row's own colour is left empty on
// purpose — it shows the group title's, see the render loop's
// `background-color: existingHolder ? … : ''`).
//
// `selectBookmarkItem()` painted `div.item-holder` in *both* cases, so selecting
// a bookmark inside a group turned exactly one row pink and left the title
// white. Nothing noticed: this file had no bookmark-page selection tests, and
// the only guard read `selectBookmarkItem()` itself, not the helper it calls.
// ---------------------------------------------------------------------------

const { ITEM_SELECTED_COLOR: selectedColor } = await importModule('modules/ui-state.js');

let bookmarkPage = null;
let bookmarkPageSeq = 0;

/**
 * The page's `selectBookmarkItem()`, imported straight from bookmark.js.
 *
 * It is a module-level function, so importing the file is all it takes: no
 * global hook, and nothing has to be driven through `DOMContentLoaded`. The
 * page's bootstrap is still run once here, because the listener is where the
 * button handlers are wired and a typo in an id would otherwise be invisible.
 */
async function importBookmark() {
    if (bookmarkPage) return bookmarkPage;
    const page = await importModule('bookmark.js');
    // A page quiet enough that the listener's own rendering does nothing:
    // `rh-group: no` skips the grouped branch, and `bookmarks.getTree` is a
    // stub that never calls back. Every id here is one bookmark.html really
    // has — the shim records unknown ids, so a typo would show up in
    // `dom.missing` rather than as a silent no-op.
    localStorage['rh-group'] = 'no';
    // `location.search` is the page URL's query string; the real one is ''.
    globalThis.location.search = '';
    dom.el('history-container');
    dom.el('rh-search');
    dom.el('rh-bar');
    dom.el('rh-bar-group');
    dom.el('rh-bar-orderby');
    dom.el('rh-bar-order');
    dom.el('master-check-all');
    dom.el('rh-views-insert').style.display = 'block';
    dom.el('rh-views-search-insert').style.display = 'none';
    // The page focuses its search box on load; the shim's elements have no
    // focus() — it is not something the extension logic depends on.
    dom.el('rh-search').focus = () => {};
    dom.el('delete-bookmark-button');
    dom.el('edit-bookmark-button');
    withChromeApi({ bookmarks: { getTree: (_cb) => {} }, history: { search: (_q, _cb) => {} } }, () => {
        globalThis.document.dispatch('DOMContentLoaded');
        // The page registers itself inside onStorageReady(); the stub queues
        // those callbacks until the storage cache is filled, exactly as the
        // adapter does, so nothing in bookmark.js runs before this line.
        env.fireStorageReady();
    });
    bookmarkPage = { selectBookmarkItem: page.selectBookmarkItem };
    return bookmarkPage;
}

/**
 * A bookmark row, optionally inside a group holder.
 *
 * `holder` puts the row in an existing holder, which is how the render loop
 * builds a group: ONE title, ONE holder, every row of that host inside it.
 */
function bookmarkRow({ grouped = false, host = 'docs.test', holder } = {}) {
    const container = dom.el('rh-views-insert');

    // A fresh URL per row: the page sweeps `#view .chkbx` and matches on
    // `value`, so two rows sharing a URL would make "uncheck this one" clear
    // both.
    const bookmarkUrl = `https://${host}/${++bookmarkPageSeq}`;
    const row = dom.makeEl('div');
    row.className = 'item-holder';
    row.setAttribute('rel', 'white');
    row.setAttribute('data-bookmark-url', bookmarkUrl);

    const input = dom.makeEl('input');
    input.className = 'chkbx bookmark-checkbox';
    input.value = bookmarkUrl;
    row.appendChild(input);

    if (grouped) {
        let into = holder;
        if (!into) {
            into = dom.makeEl('div');
            into.className = 'group-holder';
            into.setAttribute('rel', host);
            container.appendChild(into);
        }
        into.appendChild(row);
        return { row, input, holder: into };
    }
    container.appendChild(row);
    return { row, input };
}

/** The group title the render loop puts above a holder, sharing its host. */
function bookmarkGroupTitle(host) {
    const title = dom.makeEl('div');
    title.className = 'item-holder group-title';
    title.setAttribute('title', host);
    title.setAttribute('rel', 'white');
    dom.el('rh-views-insert').appendChild(title);
    return title;
}

test('selecting a bookmark paints the group title, not the row inside it', async () => {
    // A grouped row is rendered with an empty inline colour so it follows the
    // title. Painting the row itself left one pink bookmark in a group whose
    // title still read as unselected, and unticking then cleared a colour the
    // row never had.
    const { selectBookmarkItem } = await importBookmark();
    const titleDiv = dom.makeEl('div');
    titleDiv.className = 'item-holder group-title';
    titleDiv.setAttribute('title', 'docs.test');
    titleDiv.setAttribute('rel', 'white');
    dom.el('rh-views-insert').appendChild(titleDiv);
    const { row, input } = bookmarkRow({ grouped: true });

    input.checked = true;
    selectBookmarkItem(input, 'single');

    assert.equal(titleDiv.style.backgroundColor, selectedColor,
        'the group title is the element that shows the selection');
    assert.equal(row.style.backgroundColor, undefined,
        'the row must keep its empty inline colour so it still follows the title');
});

test('selecting an ungrouped bookmark paints the row itself', async () => {
    const { selectBookmarkItem } = await importBookmark();
    const { row, input } = bookmarkRow({ grouped: false });

    input.checked = true;
    selectBookmarkItem(input, 'single');

    assert.equal(row.style.backgroundColor, selectedColor);
});

test('select all then unselect all leaves the group title uncoloured', async () => {
    const { selectBookmarkItem } = await importBookmark();
    const titleDiv = dom.makeEl('div');
    titleDiv.className = 'item-holder group-title';
    titleDiv.setAttribute('title', 'docs.test');
    titleDiv.setAttribute('rel', 'white');
    titleDiv.setAttribute('title', 'bulk.test');
    dom.el('rh-views-insert').appendChild(titleDiv);
    const { row, input } = bookmarkRow({ grouped: true });

    // The row has to say which group it belongs to, exactly as the render loop
    // does it: the title carries the host in `title`, the holder in `rel`.
    row.parentNode.setAttribute('rel', 'bulk.test');
    const master = dom.el('master-check-all');

    input.checked = true;
    selectBookmarkItem(input, 'single');
    assert.equal(titleDiv.style.backgroundColor, selectedColor, 'the fixture must start selected');

    master.value = 'false';
    selectBookmarkItem(master, 'all');
    assert.equal(titleDiv.style.backgroundColor, selectedColor, 'select-all repaints it');

    master.value = 'true';
    selectBookmarkItem(master, 'all');

    assert.equal(titleDiv.style.backgroundColor, '', 'the title kept its selection colour');
    // `''` is "no inline colour", which is what an unselect has to leave behind:
    // the row then follows the stylesheet, whichever theme is in force.
    assert.equal(row.style.backgroundColor, '', 'the row kept an inline colour');
});

test('select all paints every group title, and leaves the rows to them', async () => {
    // Selecting all used to resolve a title for every row: one walk of the
    // container per row, so rows x groups — 7.5s for 8000 bookmarks over 2000
    // groups. Painting the titles in one pass after the sweep is the same
    // result, so the behaviour is what is pinned here and the cost is what the
    // static guard in static.test.mjs pins.
    const { selectBookmarkItem } = await importBookmark();
    // Hosts no other case uses: `groupTitleOf()` resolves a host to the FIRST
    // matching title in the container, and every case here appends to the same
    // one — a reused host would paint this case's rows onto an earlier case's
    // title.
    const shared = bookmarkGroupTitle('bulk-shared.test');
    const lonely = bookmarkGroupTitle('bulk-lonely.test');
    const first = bookmarkRow({ grouped: true, host: 'bulk-shared.test' });
    const second = bookmarkRow({ grouped: true, host: 'bulk-shared.test', holder: first.holder });
    const third = bookmarkRow({ grouped: true, host: 'bulk-lonely.test' });
    const master = dom.el('master-check-all');

    master.value = 'false';
    selectBookmarkItem(master, 'all');

    for (const title of [shared, lonely]) {
        assert.equal(title.style.backgroundColor, selectedColor, 'select-all missed a group title');
    }
    // A grouped row carries no colour of its own: painting it as well as the
    // title is what disconnected the two again.
    for (const row of [first, second, third]) {
        assert.equal(row.row.style.backgroundColor, undefined,
            'a grouped row was painted, so it no longer follows its title');
    }
});

test('unselecting one bookmark keeps the title of its still-ticked sibling', async () => {
    // The title is the group's, not the row's. Clearing it whenever *a* row is
    // unticked left the sibling ticked with no mark of it: `checked === true`,
    // nothing painted, and the delete button live — a click would remove a
    // bookmark that looked unselected. It is cleared by the row that empties
    // the group, and by no earlier one.
    const { selectBookmarkItem } = await importBookmark();
    const host = 'pair.test';
    const title = bookmarkGroupTitle(host);
    const first = bookmarkRow({ grouped: true, host });
    const second = bookmarkRow({ grouped: true, host, holder: first.holder });

    for (const row of [first, second]) {
        row.input.checked = true;
        selectBookmarkItem(row.input, 'single');
    }
    assert.equal(title.style.backgroundColor, selectedColor, 'the fixture must start selected');

    first.input.checked = false;
    selectBookmarkItem(first.input, 'single');

    assert.equal(second.input.checked, true, 'the sibling is still ticked');
    assert.equal(title.style.backgroundColor, selectedColor,
        'the still-ticked sibling lost the only thing that showed its selection');

    // …and the last one out does release it, or the title would stay pink over
    // an empty selection.
    second.input.checked = false;
    selectBookmarkItem(second.input, 'single');
    assert.equal(title.style.backgroundColor, '',
        'the group is empty now, so the title has to go back to the stylesheet');
});

test('one untick among many keeps every title that still has a ticked row', async () => {
    // The bulk single-untick (the sweep that follows a single click) paints no
    // title, so the titles have to be decided against the checkboxes as they
    // are once it has run — a per-row decision made *during* the sweep clears
    // every title, because the row it is looking at is the one that was just
    // unticked.
    const { selectBookmarkItem } = await importBookmark();
    const shared = bookmarkGroupTitle('shared.test');
    const lonely = bookmarkGroupTitle('lonely.test');
    const first = bookmarkRow({ grouped: true, host: 'shared.test' });
    const second = bookmarkRow({ grouped: true, host: 'shared.test', holder: first.holder });
    const third = bookmarkRow({ grouped: true, host: 'lonely.test' });

    for (const row of [first, second, third]) {
        row.input.checked = true;
        selectBookmarkItem(row.input, 'single');
    }
    assert.equal(shared.style.backgroundColor, selectedColor, 'the fixture must start selected');
    assert.equal(lonely.style.backgroundColor, selectedColor, 'the fixture must start selected');

    // The sweep unticks every row sharing a URL, so sharing one is what makes
    // it visit two groups in a single click. `second` is the survivor of the
    // shared one: unticked and re-checked here, the state the sweep decides
    // against. `third` is ticked and outside the sweep entirely — its title has
    // to survive a click that never touched its group.
    first.input.value = second.input.value;
    first.input.checked = false;
    selectBookmarkItem(first.input, 'single');

    assert.equal(third.input.checked, true, 'the other group was not touched');
    assert.equal(lonely.style.backgroundColor, selectedColor,
        'an untouched group lost its title');

    assert.equal(second.input.checked, true, 'the swept survivor is still ticked');
    assert.equal(shared.style.backgroundColor, selectedColor,
        'a group that still has a ticked row lost its title');

    // …and once nothing in that group is ticked, the title goes.
    first.input.checked = false;
    second.input.checked = false;
    selectBookmarkItem(first.input, 'single');
    assert.equal(shared.style.backgroundColor, '', 'the emptied group kept its title');
});
